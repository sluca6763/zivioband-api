function sosAlarm() {
    const now = new Date();
    const time = now.toLocaleTimeString('de-DE');

    console.log('==========================================');
    console.log(`  SOS AUSGELÖST — ${time}`);
    console.log('==========================================');

    let blink = 0;
    const interval = setInterval(() => {
        process.stdout.write(blink % 2 === 0 ? '\r  [ ALARM AKTIV ]  ' : '\r                   ');
        blink++;
        if (blink >= 10) {
            clearInterval(interval);
            console.log('\n==========================================');
            console.log('  Alarm wurde registriert.');
            console.log('==========================================');
        }
    }, 400);
}

module.exports = { sosAlarm };
