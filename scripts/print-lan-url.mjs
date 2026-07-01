import os from 'node:os';

const port = process.env.PORT || '4321';
const interfaces = os.networkInterfaces();

const addresses = Object.entries(interfaces)
  .flatMap(([name, entries = []]) =>
    entries
      .filter((entry) => entry.family === 'IPv4' && !entry.internal)
      .map((entry) => ({ name, address: entry.address }))
  )
  .sort((a, b) => {
    const score = (item) => {
      if (item.name === 'en0') return 0;
      if (item.name === 'en1') return 1;
      if (item.address.startsWith('192.168.')) return 2;
      if (item.address.startsWith('10.')) return 3;
      return 4;
    };

    return score(a) - score(b);
  });

if (addresses.length === 0) {
  console.log('No encontre una IP local. Revisa que el Mac este conectado a Wi-Fi o Ethernet.');
  process.exit(1);
}

console.log('URLs locales para abrir desde celulares en la misma red:');
for (const item of addresses) {
  console.log(`- http://${item.address}:${port}/ (${item.name})`);
}

