const net = require('net');

function runSimulation({ callerId, callerName, scenarioName, digitsToSend = ['2', '1', '1'] }) {
  return new Promise((resolve, reject) => {
    console.log(`\n============================================================`);
    console.log(`SIMULATION: ${scenarioName} (Caller ID: ${callerId})`);
    console.log(`============================================================`);

    const client = net.createConnection({ port: 4574, host: '127.0.0.1' }, () => {
      console.log(`[CONNECTED] FastAGI 4574 connected`);
      const handshake = [
        'agi_network: yes',
        'agi_network_script: ivr',
        'agi_request: agi://host.docker.internal:4574/ivr',
        `agi_channel: PJSIP/trunk-000001`,
        'agi_language: en',
        'agi_type: PJSIP',
        'agi_uniqueid: ' + Date.now(),
        'agi_version: 20.0.0',
        `agi_callerid: ${callerId}`,
        `agi_calleridname: ${callerName || 'Mobile'}`,
        'agi_callingpres: 0',
        'agi_callingani2: 0',
        'agi_callington: 0',
        'agi_callingtns: 0',
        'agi_dnid: 2000',
        'agi_rdnis: unknown',
        'agi_context: from-exotel',
        'agi_extension: 2000',
        'agi_priority: 1',
        'agi_enhanced: 0.0',
        'agi_accountcode: ',
        'agi_threadid: 9999',
        ''
      ].join('\n') + '\n';
      client.write(handshake);
    });

    let digitIdx = 0;
    let events = [];

    client.on('data', (data) => {
      const text = data.toString('utf8');
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

      for (const cmd of lines) {
        if (cmd.startsWith('ANSWER') || cmd.startsWith('EXEC Verbose') || cmd.startsWith('HANGUP')) {
          if (cmd.startsWith('EXEC Verbose')) {
            events.push(cmd);
          }
          client.write('200 result=0\n');
        } else if (cmd.startsWith('STREAM FILE')) {
          events.push(cmd);
          if (digitIdx < digitsToSend.length) {
            const digit = digitsToSend[digitIdx++];
            const ascii = digit.charCodeAt(0);
            console.log(`[DTMF INJECTED] Pressed '${digit}' during prompt`);
            client.write(`200 result=${ascii}\n`);
          } else {
            client.write('200 result=0\n');
          }
        } else if (cmd.startsWith('WAIT FOR DIGIT 250')) {
          // Internal AsteriskAdapter DTMF buffer drain
          client.write('200 result=0\n');
        } else if (cmd.startsWith('WAIT FOR DIGIT')) {
          if (digitIdx < digitsToSend.length) {
            const digit = digitsToSend[digitIdx++];
            const ascii = digit.charCodeAt(0);
            console.log(`[DTMF INJECTED] Pressed '${digit}' on wait for digit`);
            client.write(`200 result=${ascii}\n`);
          } else {
            client.write('200 result=0\n');
          }
        } else {
          client.write('200 result=0\n');
        }

      }
    });

    client.on('close', () => {
      console.log(`[DISCONNECTED] Call ended`);
      resolve(events);
    });

    client.on('error', (err) => {
      reject(err);
    });
  });
}

async function runAll() {
  // Scenario 1: Real Mobile Registered Caller 9000000016
  // Digits: 2 (English) -> 1 (Confirm Deepak) -> 1 (Book Visit)
  const regEvents = await runSimulation({
    callerId: '9000000016',
    callerName: 'Real Mobile Farmer',
    scenarioName: 'Real Mobile Call -> Registered Farmer (9000000016)',
    digitsToSend: ['2', '1', '1']
  });

  const regOutput = regEvents.join('\n');
  const foundFarmer = regOutput.includes('Deepak') || regOutput.includes('F969805');
  const bookedOrConfirmed = regOutput.includes('Booked') || regOutput.includes('booking') || regOutput.includes('active booking');
  console.log(`[VERIFICATION 1 - REGISTERED]: Farmer identified: ${foundFarmer}, Action completed: ${bookedOrConfirmed}`);

  // Scenario 2: Real Mobile Unregistered Caller 9999999999
  // Digits: 2 (English) -> Expected: Not registered message and disconnect
  const unregEvents = await runSimulation({
    callerId: '9999999999',
    callerName: 'Unregistered Mobile',
    scenarioName: 'Real Mobile Call -> Unregistered Caller (9999999999)',
    digitsToSend: ['2']
  });

  const unregOutput = unregEvents.join('\n');
  const notRegistered = unregOutput.includes('not registered') || unregOutput.includes('not_registered') || unregOutput.includes('பதிவு');
  console.log(`[VERIFICATION 2 - UNREGISTERED]: Properly rejected as unregistered: ${notRegistered}`);

  console.log('\n============================================================');
  console.log('REAL MOBILE SIMULATION TEST COMPLETE');
  console.log('============================================================');
  process.exit(0);
}

runAll().catch(e => {
  console.error(e);
  process.exit(1);
});
