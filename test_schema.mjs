
fetch('https://iwdtelsfbjmjvbddlfmz.supabase.co/rest/v1/mi_agenda?limit=1', {
  headers: {
    'apikey': 'sb_publishable__n7v-Vxt59W7ygrEQ2vssQ_AShBv3Ul',
    'Authorization': 'Bearer sb_publishable__n7v-Vxt59W7ygrEQ2vssQ_AShBv3Ul'
  }
}).then(r => r.json()).then(d => {
  if (d.length > 0) {
    console.log('--- COLUMNS IN MI_AGENDA VIEW ---');
    console.log(Object.keys(d[0]).join('\n'));
  } else {
    console.log('View is empty.');
  }
}).catch(console.error);

