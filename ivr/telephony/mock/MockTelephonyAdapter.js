const TelephonyAdapter = require('../TelephonyAdapter');

class MockTelephonyAdapter extends TelephonyAdapter {
  constructor(callerNumber, scriptedInputs = []) {
    super();
    this.callerNumber = callerNumber;
    this.scriptedInputs = [...scriptedInputs];
    this.spokenMessages = [];
    this.audioFilesPlayed = [];
    this.callAnswered = false;
    this.callHungUp = false;
    this.inputIndex = 0;
  }

  async answerCall() {
    this.callAnswered = true;
    return { code: 200, result: 1 };
  }

  getCallerNumber() {
    return this.callerNumber;
  }

  async playAudio(audioFile) {
    this.audioFilesPlayed.push(audioFile);
    return { code: 200, result: 1 };
  }

  async speak(text, language = 'en') {
    this.spokenMessages.push({ text, language, timestamp: Date.now() });
    return { code: 200, result: 1 };
  }

  async collectDTMF(maxDigits = 1, timeoutMs = 6000) {
    if (this.inputIndex < this.scriptedInputs.length) {
      const input = this.scriptedInputs[this.inputIndex++];
      return input;
    }
    return ''; // simulated timeout
  }

  async hangup() {
    this.callHungUp = true;
    return { code: 200, result: 1 };
  }

  // Test helper methods
  getAllSpokenText() {
    return this.spokenMessages.map(m => m.text).join(' | ');
  }

  hasSpokenPattern(regex) {
    return this.spokenMessages.some(m => regex.test(m.text));
  }
}

module.exports = MockTelephonyAdapter;
