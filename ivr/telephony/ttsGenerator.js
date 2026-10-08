const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const SOUNDS_DIR = path.resolve(__dirname, '../asterisk/sounds');

// Ensure sounds directory exists
if (!fs.existsSync(SOUNDS_DIR)) {
  fs.mkdirSync(SOUNDS_DIR, { recursive: true });
}

class TtsGenerator {
  constructor(soundsDir = SOUNDS_DIR) {
    this.soundsDir = soundsDir;
    this.cache = new Map();
  }

  formatForTts(text, language = 'en') {
    if (!text) return '';
    let formatted = String(text).trim();

    // Special case for initial language prompt
    if (formatted.includes('தமிழுக்கு 1') && formatted.includes('Press 2')) {
      return 'தமிழுக்கு 1 அழுத்தவும். Press 2 for English. हिंदी के लिए 3 दबाएं.';
    }

    // Space out alphanumeric IDs like F131074 -> F 1 3 1 0 7 4
    formatted = formatted.replace(/\b([A-Za-z]+)(\d+)\b/g, (match, letters, numbers) => {
      return letters.split('').join(' ') + ' ' + numbers.split('').join(' ');
    });

    // Space out tokens like DEMO_F_000004 -> Farmer 4
    formatted = formatted.replace(/DEMO_F_0*(\d+)/gi, (match, num) => {
      return 'ID ' + num.split('').join(' ');
    });

    formatted = formatted.replace(/\b([A-Za-z])-(\d+)\b/g, (match, letter, numbers) => {
      return letter + ' ' + numbers.split('').join(' ');
    });

    return formatted;
  }

  getPromptAudioFile(text, language = 'en') {
    if (!text) return null;
    const cleanText = this.formatForTts(text, language);

    // If initial language prompt, return dedicated high-quality initial_lang audio
    if (cleanText.includes('தமிழுக்கு 1') && cleanText.includes('Press 2')) {
      const initialPath = path.join(this.soundsDir, 'initial_lang.wav');
      if (fs.existsSync(initialPath) && fs.statSync(initialPath).size > 1000) {
        return 'kisan/initial_lang';
      }
    }

    const hash = crypto.createHash('md5').update(`${language}:${cleanText}`).digest('hex').slice(0, 12);
    const soundKey = `prompt_${hash}`;
    const wavPath = path.join(this.soundsDir, `${soundKey}.wav`);

    if (this.cache.has(soundKey)) {
      return this.cache.get(soundKey);
    }

    // If pre-generated file exists and is valid (> 500 bytes to avoid empty 46 byte files)
    if (fs.existsSync(wavPath) && fs.statSync(wavPath).size > 500) {
      const astPath = `kisan/${soundKey}`;
      this.cache.set(soundKey, astPath);
      return astPath;
    }

    // Dynamic Online Synthesis using Google TTS + ffmpeg in Asterisk container
    try {
      const langCode = (language === 'Tamil' || language === 'ta') ? 'ta' : ((language === 'Hindi' || language === 'hi') ? 'hi' : 'en');
      // Split on clauses to keep chunks under 100 chars
      const rawChunks = cleanText.split(/([,.;!?\n।:]+)/).map(s => s.trim()).filter(Boolean);
      const chunks = [];
      let temp = '';
      for (const c of rawChunks) {
        if ((temp + ' ' + c).length < 100) {
          temp = temp ? (temp + ' ' + c) : c;
        } else {
          if (temp) chunks.push(temp);
          temp = c;
        }
      }
      if (temp) chunks.push(temp);

      const chunkFiles = [];
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        if (!chunk) continue;
        const chunkFile = path.join(this.soundsDir, `dyn_${Date.now()}_${i}.mp3`);
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(chunk)}&tl=${langCode}&client=tw-ob`;
        execSync(`curl -s -A "Mozilla/5.0" "${url}" -o "${chunkFile}"`, { timeout: 6000 });
        if (fs.existsSync(chunkFile) && fs.statSync(chunkFile).size > 100) {
          chunkFiles.push(chunkFile);
        }
      }

      if (chunkFiles.length > 0) {
        const inputs = chunkFiles.map(f => `-i "/var/lib/asterisk/sounds/kisan/${path.basename(f)}"`).join(' ');
        const filter = chunkFiles.map((_, i) => `[${i}:a]`).join('') + `concat=n=${chunkFiles.length}:v=0:a=1,atempo=0.88[out]`;
        execSync(`docker exec kisan-queue-asterisk ffmpeg -y ${inputs} -filter_complex "${filter}" -map "[out]" -ar 8000 -ac 1 -c:a pcm_s16le "/var/lib/asterisk/sounds/kisan/${soundKey}.wav"`, { timeout: 10000 });
        chunkFiles.forEach(f => { try { fs.unlinkSync(f); } catch (_) {} });

        if (fs.existsSync(wavPath) && fs.statSync(wavPath).size > 500) {
          const astPath = `kisan/${soundKey}`;
          this.cache.set(soundKey, astPath);
          return astPath;
        }
      }
    } catch (err) {
      console.warn(`[TTS] Dynamic Google synthesis error for "${cleanText.slice(0, 30)}":`, err.message);
    }

    // Fallback: PowerShell synthesizer for English only
    if (language === 'English' || language === 'en') {
      try {
        const escaped = cleanText.replace(/["`$]/g, ' ').replace(/\s+/g, ' ');
        const psScript = [
          'Add-Type -AssemblyName System.Speech;',
          '$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer;',
          '$synth.Rate = -2;',
          '$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(8000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono);',
          `$synth.SetOutputToWaveFile('${wavPath.replace(/\\/g, '\\\\')}', $format);`,
          `$synth.Speak('${escaped}');`,
          '$synth.Dispose();'
        ].join(' ');

        execSync(`powershell -NoProfile -Command "${psScript}"`, { timeout: 8000, stdio: 'ignore' });
        if (fs.existsSync(wavPath) && fs.statSync(wavPath).size > 500) {
          const astPath = `kisan/${soundKey}`;
          this.cache.set(soundKey, astPath);
          return astPath;
        }
      } catch (_) {}
    }

    return null;
  }
}

module.exports = new TtsGenerator();
