const TelephonyAdapter = require('../TelephonyAdapter');
const ttsGenerator = require('../ttsGenerator');

/**
 * Asterisk FastAGI Telephony Adapter
 * Wraps FastAGI TCP socket protocol into TelephonyAdapter interface.
 * Implements robust socket lifecycle management and [IVR TRACE] diagnostic logging.
 */
class AsteriskAdapter extends TelephonyAdapter {
  constructor(socket, headers = {}) {
    super(headers);
    this.socket = socket;
    this.headers = headers;
    this.channelId = headers.agi_channel || 'unknown_channel';
    this.callerNumber = this._extractCallerNumber(headers);
    this.pendingResolvers = [];
    this.buffer = '';
    this.bufferedDtmf = [];
    this.isEnded = false;

    console.log(`[IVR TRACE][${this.channelId}] AGI CONNECTED from caller: ${this.callerNumber}`);

    this.socket.on('data', (data) => {
      if (this.isEnded) return;
      this.buffer += data.toString('utf8');
      this._processBuffer();
    });

    this.socket.on('error', (err) => {
      this.isEnded = true;
      console.warn(`[IVR TRACE][${this.channelId}] SOCKET ERROR:`, err.message);
      this._rejectAllPending(err);
    });

    this.socket.on('close', () => {
      this.isEnded = true;
      console.log(`[IVR TRACE][${this.channelId}] SOCKET CLOSE`);
      this._rejectAllPending(new Error('Asterisk channel closed'));
    });

    this.socket.on('end', () => {
      this.isEnded = true;
      console.log(`[IVR TRACE][${this.channelId}] SOCKET END`);
      this._rejectAllPending(new Error('Asterisk channel ended'));
    });
  }

  _extractCallerNumber(headers) {
    const raw = headers.agi_callerid || headers.agi_callingpres || headers.agi_calleridname || '';
    const digits = raw.replace(/\D/g, '');
    if (digits.length >= 10) {
      return digits.slice(-10);
    }
    return digits || raw || 'UNKNOWN';
  }

  _processBuffer() {
    let newlineIndex;
    while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);

      if (line.length > 0 && this.pendingResolvers.length > 0) {
        const resolver = this.pendingResolvers.shift();
        console.log(`[IVR TRACE][${this.channelId}] AGI RESPONSE RECEIVED: ${line}`);
        resolver(line);
      }
    }
  }

  _rejectAllPending(err) {
    while (this.pendingResolvers.length > 0) {
      const resolver = this.pendingResolvers.shift();
      resolver(`500 error: ${err.message}`);
    }
  }

  /**
   * Send a raw AGI command and await single-line response from Asterisk.
   * @param {string} command 
   * @returns {Promise<string>}
   */
  sendCommand(command) {
    if (this.isEnded || !this.socket || this.socket.destroyed || !this.socket.writable) {
      console.log(`[IVR TRACE][${this.channelId}] Skipped sendCommand (channel closed): ${command}`);
      return Promise.resolve('500 channel already closed');
    }

    console.log(`[IVR TRACE][${this.channelId}] AGI COMMAND SENT: ${command}`);

    return new Promise((resolve) => {
      this.pendingResolvers.push(resolve);
      try {
        this.socket.write(`${command}\n`, (err) => {
          if (err) {
            this.isEnded = true;
            console.warn(`[IVR TRACE][${this.channelId}] Socket write error:`, err.message);
            const idx = this.pendingResolvers.indexOf(resolve);
            if (idx !== -1) this.pendingResolvers.splice(idx, 1);
            resolve(`500 write error: ${err.message}`);
          }
        });
      } catch (err) {
        this.isEnded = true;
        console.warn(`[IVR TRACE][${this.channelId}] Socket write exception:`, err.message);
        const idx = this.pendingResolvers.indexOf(resolve);
        if (idx !== -1) this.pendingResolvers.splice(idx, 1);
        resolve(`500 write exception: ${err.message}`);
      }
    });
  }

  parseResponse(responseLine) {
    const match = responseLine.match(/^200\s+result=(-?\w+)(?:\s+\((.*?)\))?/);
    if (!match) {
      return { code: 500, result: null, raw: responseLine };
    }
    return {
      code: 200,
      result: match[1],
      extra: match[2] || null,
      raw: responseLine
    };
  }

  async answerCall() {
    if (this.isEnded) return { code: 500, result: null };
    console.log(`[IVR TRACE][${this.channelId}] CALL START - Answering channel`);
    const res = await this.sendCommand('ANSWER');
    return this.parseResponse(res);
  }

  getCallerNumber() {
    return this.callerNumber;
  }

  setCallerNumber(num) {
    this.callerNumber = num;
  }

  async playAudio(audioFile) {
    if (this.isEnded) return { code: 500, result: null };
    console.log(`[IVR TRACE][${this.channelId}] STREAM FILE ${audioFile} START`);
    const res = await this.sendCommand(`STREAM FILE "${audioFile}" "0123456789*#"`);
    const parsed = this.parseResponse(res);
    console.log(`[IVR TRACE][${this.channelId}] STREAM FILE RESULT: ${parsed.result}`);
    if (parsed.result && parsed.result !== '0' && parsed.result !== '-1') {
      const asciiVal = parseInt(parsed.result, 10);
      if (!isNaN(asciiVal) && asciiVal > 0) {
        const digit = String.fromCharCode(asciiVal);
        console.log(`[IVR TRACE][${this.channelId}] Barge-in DTMF digit during playback: ${digit}`);
        this.bufferedDtmf.push(digit);
        try {
          await this.drainResidualDtmf(250);
        } catch (_) {}
      }
    }
    return parsed;
  }

  async drainResidualDtmf(timeoutMs = 250) {
    if (this.isEnded) return;
    try {
      const resp = await this.sendCommand(`WAIT FOR DIGIT ${timeoutMs}`);
      const parsed = this.parseResponse(resp);
      if (parsed.result && parsed.result !== '0' && parsed.result !== '-1') {
        console.log(`[IVR TRACE][${this.channelId}] Drained duplicate DTMF tail frame: ${parsed.result}`);
      }
    } catch (_) {}
  }

  async speak(text, language = 'en') {
    if (this.isEnded || !text) return;
    const clean = String(text).trim();

    // If pure digits, speak digits using Asterisk SAY DIGITS or SAY NUMBER
    if (/^\d+$/.test(clean)) {
      if (clean.length > 4) {
        console.log(`[IVR TRACE][${this.channelId}] SAY DIGITS ${clean}`);
        await this.sendCommand(`SAY DIGITS ${clean} "0123456789*#"`);
      } else {
        console.log(`[IVR TRACE][${this.channelId}] SAY NUMBER ${clean}`);
        await this.sendCommand(`SAY NUMBER ${clean} "0123456789*#"`);
      }
      return;
    }

    await this.sendCommand(`EXEC Verbose 1,"[IVR TTS ${language}] ${clean.slice(0, 50)}..."`);

    // Check for cached/generated prompt audio file
    const audioPrompt = ttsGenerator.getPromptAudioFile(clean, language);
    if (audioPrompt) {
      await this.playAudio(audioPrompt);
      console.log(`[IVR TRACE][${this.channelId}] PROMPT COMPLETE (${audioPrompt})`);
      return;
    }

    // Attempt standard sound prompt playback if formatted like a sound identifier
    if (/^[a-zA-Z0-9_\-]+$/.test(clean)) {
      await this.playAudio(clean);
      console.log(`[IVR TRACE][${this.channelId}] PROMPT COMPLETE (${clean})`);
      return;
    }

    // Fallback brief pause
    await this.sendCommand('WAIT FOR DIGIT 1000');
  }

  async collectDTMF(maxDigits = 1, timeoutMs = 6000) {
    if (this.isEnded) return '';
    console.log(`[IVR TRACE][${this.channelId}] DTMF WAIT START (timeout: ${timeoutMs}ms, maxDigits: ${maxDigits})`);

    let digits = '';

    // First digit
    let firstDigit = '';
    if (this.bufferedDtmf.length > 0) {
      firstDigit = this.bufferedDtmf.shift();
      console.log(`[IVR TRACE][${this.channelId}] Consumed buffered DTMF: ${firstDigit}`);
    } else {
      const resp = await this.sendCommand(`WAIT FOR DIGIT ${timeoutMs}`);
      const parsed = this.parseResponse(resp);
      if (parsed.result && parsed.result !== '0' && parsed.result !== '-1') {
        const asciiVal = parseInt(parsed.result, 10);
        if (!isNaN(asciiVal) && asciiVal > 0) {
          firstDigit = String.fromCharCode(asciiVal);
        } else {
          firstDigit = String(parsed.result);
        }
      }
    }

    if (!firstDigit || firstDigit === '#' || firstDigit === '*') {
      console.log(`[IVR TRACE][${this.channelId}] DTMF RECEIVED: ${firstDigit || '<TIMEOUT>'}`);
      return firstDigit || '';
    }
    digits += firstDigit;

    // If maxDigits > 1, collect subsequent digits with a 2500ms inter-digit timeout
    while (digits.length < maxDigits && !this.isEnded) {
      let nextDigit = '';
      if (this.bufferedDtmf.length > 0) {
        nextDigit = this.bufferedDtmf.shift();
      } else {
        const resp = await this.sendCommand('WAIT FOR DIGIT 2500');
        const parsed = this.parseResponse(resp);
        if (parsed.result && parsed.result !== '0' && parsed.result !== '-1') {
          const asciiVal = parseInt(parsed.result, 10);
          if (!isNaN(asciiVal) && asciiVal > 0) {
            nextDigit = String.fromCharCode(asciiVal);
          } else {
            nextDigit = String(parsed.result);
          }
        }
      }

      if (!nextDigit || nextDigit === '#') {
        break;
      }
      if (nextDigit === '*') {
        break;
      }
      digits += nextDigit;
    }

    console.log(`[IVR TRACE][${this.channelId}] DTMF RECEIVED: ${digits}`);
    return digits;
  }

  async hangup() {
    if (this.isEnded) return;
    this.isEnded = true;

    console.log(`[IVR TRACE][${this.channelId}] HANGUP REQUESTED`);

    try {
      if (this.socket && !this.socket.destroyed && this.socket.writable) {
        await this.sendCommand('HANGUP');
      }
    } catch (_) {}

    try {
      if (this.socket && !this.socket.destroyed) {
        this.socket.end();
      }
    } catch (_) {}

    console.log(`[IVR TRACE][${this.channelId}] CALL END`);
    this._rejectAllPending(new Error('Channel hung up'));
  }
}

module.exports = AsteriskAdapter;
