const net = require('net');

async function testDeepakStatus() {
  console.log('TEST: DEEPAK CHECKING BOOKING STATUS (Option 2)');
  // 2 = English, 1 = Confirm Identity, 2 = Check Status, 9 = Exit
  const digits = ['2', '1', '2', '9'];
  let digitIdx = 0;

  await new Promise((resolve, reject) => {
    const client = net.createConnection({ port: 4574, host: '127.0.0.1' }, () => {
      const handshake = [
        'agi_network: yes',
        'agi_network_script: ivr',
        'agi_request: agi://host.docker.internal:4574/ivr',
        'agi_channel: PJSIP/1001-00000099',
        'agi_language: en',
        'agi_type: PJSIP',
        'agi_uniqueid: ' + Date.now(),
        'agi_version: 20.0.0',
        'agi_callerid: 1001',
        'agi_calleridname: MicroSIP',
        'agi_dnid: 2000',
        'agi_context: from-internal',
        'agi_extension: 2000',
        'agi_priority: 1',
        ''
      ].join('\n') + '\n';
      client.write(handshake);
    });

    client.on('data', (d) => {
      const text = d.toString('utf8');
      for (const line of text.split('\n').filter(Boolean)) {
        if (line.includes('EXEC Verbose')) {
          console.log('[IVR SPOKEN]:', line.trim());
        }
        if (line.includes('initial_lang') || line.includes('STREAM FILE') || line.includes('WAIT FOR DIGIT 6000')) {
          if (digitIdx < digits.length) {
            const dig = digits[digitIdx++];
            console.log(`>>> Injecting DTMF: ${dig}`);
            client.write(`200 result=${dig.charCodeAt(0)}\n`);
          } else {
            client.write('200 result=0\n');
          }
        } else {
          client.write('200 result=0\n');
        }
      }
    });

    client.on('close', resolve);
    client.on('error', reject);
  });
}

testDeepakStatus().catch(console.error);
