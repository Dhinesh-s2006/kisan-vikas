const prompts = require('./promptMessages');

class LanguageManager {
  constructor(defaultLanguage = 'Tamil') {
    this.currentLanguage = 'Tamil';
    this.setLanguage(defaultLanguage);
  }

  setLanguage(lang) {
    if (!lang) return;
    const l = String(lang).toLowerCase().trim();
    if (l === 'tamil' || l === 'ta' || l === '1') {
      this.currentLanguage = 'Tamil';
    } else if (l === 'english' || l === 'en' || l === '2') {
      this.currentLanguage = 'English';
    } else if (l === 'hindi' || l === 'hi' || l === '3') {
      this.currentLanguage = 'Hindi';
    }
  }

  getLanguage() {
    return this.currentLanguage;
  }

  get(key, params = {}) {
    const dict = prompts[this.currentLanguage] || prompts['English'];
    let msg = dict[key] || prompts['English'][key] || key;

    for (const [k, v] of Object.entries(params)) {
      msg = msg.replace(new RegExp(`\\{${k}\\}`, 'g'), v != null ? String(v) : '');
    }

    return msg;
  }
}

module.exports = LanguageManager;
