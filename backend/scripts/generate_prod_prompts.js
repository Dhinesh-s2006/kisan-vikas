require('dotenv').config({ path: 'c:/Users/DHINESH.S/Desktop/kisan-queue/backend/.env' });
const SarvamTTSProvider = require('../services/speech/sarvamTTSProvider');
const fs = require('fs');
const path = 'C:/KisanQueue-IVR/asterisk/sounds';

const prompts = {
  'kisan_new_identity_confirm': 'Welcome to Kisan Queue. We found your registered farmer account. If this is correct, press 1. To end this call, press 2.',
  'kisan_new_welcome_menu': 'Please choose an option. Press 1 to book a procurement visit. Press 2 to check your booking. Press 3 to check procurement centre status. Press 4 to check payment status. Press 5 for grievance. Press 9 for help.',
  'kisan_new_unregistered': 'We could not find a registered farmer account for this phone number. Please register on Kisan Queue or visit your nearest assisted service centre. Thank you.',
  'kisan_new_booking_received': 'Your booking request has been received. We will find a suitable procurement centre and available time for you. Your confirmed booking details will be sent to your registered mobile number.',
  'kisan_new_booking_success': 'Your procurement visit has been booked successfully. Your booking details have been sent by SMS. Thank you.',
  'kisan_new_active_exists': 'Notice: You already have an active procurement appointment. Farmers may only hold one active booking at a time. Goodbye.',
  'kisan_new_no_slots': 'We could not find an available slot at this time. Your request has not been booked. Please try again later or use the Kisan Queue website.',
  'kisan_new_status_none': 'You currently do not have an active procurement booking. Goodbye.',
  'kisan_new_centre_status': 'Your procurement centre is currently open and operational. Goodbye.',
  'kisan_new_payment_status': 'All your past procurement payments have been credited directly to your registered bank account. Goodbye.',
  'kisan_new_grievance_help': 'For grievance assistance or helpline support, our officer toll-free number is 1 8 0 0 4 2 5 0 0 1. Your inquiry has been recorded. Goodbye.',
  'kisan_new_call_ended': 'Thank you for calling Kisan Queue. Goodbye.',
  'kisan_new_service_error': 'We are unable to access the service right now. Please try again later. Goodbye.'
};

async function generatePrompts() {
  const tts = new SarvamTTSProvider({ model: 'bulbul:v3', speaker: 'priya' });
  for (const [name, text] of Object.entries(prompts)) {
    console.log('Generating:', name);
    try {
      const res = await tts.synthesize({ text, languageCode: 'en-IN' });
      if (res.audioBase64) {
        const buf = Buffer.from(res.audioBase64, 'base64');
        fs.writeFileSync(`${path}/${name}.wav`, buf);
        console.log(`Saved ${name}.wav (${buf.length} bytes)`);
      } else {
        console.error(`Failed to generate ${name}:`, res.error);
      }
    } catch (e) {
      console.error(`Error on ${name}:`, e.message);
    }
  }
  console.log('All prompts generated successfully.');
}

generatePrompts().catch(console.error);
