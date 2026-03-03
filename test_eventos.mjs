
fetch('https://iwdtelsfbjmjvbddlfmz.supabase.co/rest/v1/eventos', {
  headers: {
    'apikey': 'sb_publishable__n7v-Vxt59W7ygrEQ2vssQ_AShBv3Ul',
    'Authorization': 'Bearer sb_publishable__n7v-Vxt59W7ygrEQ2vssQ_AShBv3Ul'
  }
}).then(r => r.json()).then(d => {
    console.log('--- RAW EVENTOS TABLE ---');
    console.log(d);
}).catch(console.error);

