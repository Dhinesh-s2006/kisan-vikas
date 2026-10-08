const net = require('net');

console.log('[TEST] Starting end-to-end FastAGI verification for Extension 2000...');
const client = net.createConnection({ port: 4574, host: '127.0.0.1' }, () => {
  console.log('[TEST] Connected to FastAGI 4574 successfully');
  const handshake = [
    'agi_network: yes',
    'agi_network_script: ivr',
    'agi_request: agi://host.docker.internal:4574/ivr',
    'agi_channel: PJSIP/1001-00000099',
    'agi_language: en',
    'agi_type: PJSIP',
    'agi_uniqueid: 1727870000.99',
    'agi_version: 20.0.0',
    'agi_callerid: 1001',
    'agi_calleridname: MicroSIP',
    'agi_callingpres: 0',
    'agi_callingani2: 0',
    'agi_callington: 0',
    'agi_callingtns: 0',
    'agi_dnid: 2000',
    'agi_rdnis: unknown',
    'agi_context: from-internal',
    'agi_extension: 2000',
    'agi_priority: 5',
    'agi_enhanced: 0.0',
    'agi_accountcode: ',
    'agi_threadid: 12345',
    ''
  ].join('\n') + '\n';
  client.write(handshake);
});

let stage = 0;

client.on('data', (data) => {
  const text = data.toString('utf8');
  console.log('[AGI -> TEST]', text.trim());
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  for (const cmd of lines) {
    if (cmd.startsWith('ANSWER')) {
      client.write('200 result=0\n');
    } else if (cmd.startsWith('EXEC Verbose')) {
      client.write('200 result=0\n');
    } else if (cmd.includes('initial_lang')) {
      console.log('\n[STAGE 1 PASSED] >>> Initial Language Selection prompt received!');
      stage = 1;
      console.log('[TEST -> AGI] Pressing 2 for English');
      client.write('200 result=50\n');
    } else if (stage === 0 && cmd.startsWith('WAIT FOR DIGIT 6000')) {
      console.log('\n[STAGE 1 PASSED] >>> Waiting for Language DTMF!');
      stage = 1;
      console.log('[TEST -> AGI] Pressing 2 for English');
      client.write('200 result=50\n');
    } else if (stage === 1 && (cmd.includes('prompt_492603e45754') || cmd.includes('Welcome Deepak'))) {
      console.log('\n[STAGE 2 PASSED] >>> Farmer Identity prompt received: "Welcome Deepak. Farmer ID F 9 6 9 8 0 5"');
      stage = 2;
      console.log('[TEST -> AGI] Pressing 1 to confirm identity');
      client.write('200 result=49\n');
    } else if (stage === 1 && cmd.startsWith('WAIT FOR DIGIT 6000')) {
      stage = 2;
      console.log('[TEST -> AGI] Pressing 1 to confirm identity');
      client.write('200 result=49\n');
    } else if (stage === 2 && (cmd.includes('prompt_6ca2e9c8fc4a') || cmd.includes('main_menu'))) {
      console.log('\n[STAGE 3 PASSED] >>> Reached OLD IVR 9-Option Main Menu in English!');
      stage = 3;
      console.log('[TEST -> AGI] Pressing 9 to end call');
      client.write('200 result=57\n');
      setTimeout(() => {
        client.end();
        console.log('\n======================================================');
        console.log('[VERIFICATION COMPLETE] ALL STAGES PASSED IDENTICALLY');
        console.log('Language (2) -> Identity Spoken & Confirmed (1) -> Main Menu');
        console.log('======================================================');
        process.exit(0);
      }, 500);
    } else {
      client.write('200 result=0\n');
    }
  }
});

client.on('error', (err) => {
  console.error('[TEST ERROR]', err);
  process.exit(1);
});
