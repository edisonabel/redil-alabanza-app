document.addEventListener("DOMContentLoaded",()=>{const O=["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"],S={Db:"C#",Eb:"D#",Gb:"F#",Ab:"G#",Bb:"A#"},m=document.getElementById("input-chordpro"),y=document.getElementById("output-chordpro"),z=document.getElementById("btn-subir"),R=document.getElementById("btn-bajar"),D=document.getElementById("btn-reset"),j=document.getElementById("btn-copiar"),G=document.getElementById("btn-autoconvertir");let h=0,I="";function M(i){if(i.trim().length===0)return!1;const e=/^[A-G][#b]?(m|maj|min|sus|dim|aug|[0-9])*(?:\/[A-G][#b]?)?$/i,n=i.trim().split(/\s+/),t=n.filter(r=>e.test(r));return n.length>0&&t.length/n.length>=.6}function U(i){const e=i.split(`
`);let n=[],t=0;for(;t<e.length;){const r=e[t],l=t+1<e.length?e[t+1]:null;if(M(r)){const d=/([A-G][^\s]*)/g;let f;const a=[];for(;(f=d.exec(r))!==null;)a.push({acorde:f[1],index:f.index});if(l!==null&&!M(l)&&l.trim().length>0){let o=l.trimEnd();for(let p=a.length-1;p>=0;p--){const{acorde:g,index:c}=a[p];c>o.length&&(o=o.padEnd(c," ")),o=o.slice(0,c)+`[${g}]`+o.slice(c)}n.push(o),t+=2}else{let o=r;for(let p=a.length-1;p>=0;p--){const{acorde:g,index:c}=a[p];o=o.slice(0,c)+`[${g}]`+o.slice(c+g.length)}n.push(o),t++}}else n.push(r),t++}return n.join(`
`)}function F(i,e){const n=i.match(/^([A-G][#b]?)(.*)$/);if(!n)return i;let t=n[1];const r=n[2];S[t]&&(t=S[t]);const l=O.indexOf(t);if(l===-1)return i;let d=(l+e)%12;return d<0&&(d+=12),O[d]+r}function w(){if(!m||!y)return;const i=I||m.value;if(h===0){y.value=i;return}const e=/\[(.*?)\]/g;y.value=i.replace(e,(n,t)=>"["+F(t,h)+"]")}z&&z.addEventListener("click",()=>{h++,w()}),R&&R.addEventListener("click",()=>{h--,w()}),D&&D.addEventListener("click",()=>{h=0,w()}),m&&m.addEventListener("input",()=>{I="",h=0,w()}),G&&m&&G.addEventListener("click",()=>{m.value.trim()!==""&&(I=U(m.value),h=0,w())}),j&&y&&j.addEventListener("click",async i=>{try{await navigator.clipboard.writeText(y.value);const e=i.currentTarget,n=e.innerHTML;e.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg> ¡Copiado!',e.classList.replace("bg-blue-600","bg-emerald-600"),e.classList.replace("hover:bg-blue-500","hover:bg-emerald-500"),setTimeout(()=>{e.innerHTML=n,e.classList.replace("bg-emerald-600","bg-blue-600"),e.classList.replace("hover:bg-emerald-500","hover:bg-blue-500")},2e3)}catch{alert("Error al copiar al portapapeles")}}),document.getElementById("btn-imprimir")?.addEventListener("click",()=>{const i=document.getElementById("print-titulo"),e=document.getElementById("print-artista"),n=document.getElementById("print-tono"),t=document.getElementById("print-bpm"),r=i?.value.trim()||"SIN TÍTULO",l=e?.value.trim()||"",d=n?.value.trim()||"",f=t?.value.trim()||"",a=document.getElementById("output-chordpro"),o=document.getElementById("input-chordpro"),g=(a&&a.value.trim()!==""?a.value:o?o.value:"").split(`
`),c=g.length;let k="";c<=35?k=`
                  .chord { font-size: 15px; }
                  .lyric, .lyric-line { font-size: 17px; min-height: 18px; }
                  .section-label { font-size: 14px; width: 130px; }
                  .song-section { margin-bottom: 24px; }
                  @page { margin: 15mm 20mm; }
                `:c<=50?k=`
                  .chord { font-size: 13px; }
                  .lyric, .lyric-line { font-size: 14px; min-height: 15px; }
                  .section-label { font-size: 13px; width: 110px; }
                  .song-section { margin-bottom: 14px; }
                  header { margin-bottom: 20px; padding-bottom: 10px; }
                  .header-left h1 { font-size: 26px; }
                  @page { margin: 12mm 15mm; }
                `:k=`
                  .chord { font-size: 11px; margin-bottom: 0px; }
                  .lyric, .lyric-line { font-size: 12px; min-height: 13px; }
                  .section-label { font-size: 11px; width: 85px; }
                  .song-section { margin-bottom: 8px; }
                  header { margin-bottom: 15px; padding-bottom: 5px; }
                  .header-left h1 { font-size: 20px; }
                  .header-left h2 { font-size: 14px; }
                  @page { margin: 8mm 12mm; }
                `;let s="",v=!1;g.forEach(E=>{if(E.trim()===""){v&&(s+='<div class="spacer"></div>');return}const N=E.replace(/\[.*?\]/g,"").trim(),H=/^(VERSO\s*\d*|CORO\s*\d*|PUENTE\s*\d*|INTRO\s*\d*|OUTRO|FINAL|PRE-CORO|PRECORO|ESTR|INSTRUMENTAL|TAG)[\s\:\-]*(.*)$/i,$=N.match(H);let T=E;if($){v&&(s+="</div></div>");const u=$[1].toUpperCase(),b=$[2];s+=`<div class="song-section"><div class="section-label">${u}</div><div class="section-content">`,v=!0;let A="",L=!1,V=N.length-b.length,P=0;for(let C=0;C<E.length;C++){let B=E[C];B==="["&&(L=!0),L?(A+=B,B==="]"&&(L=!1)):P<V?P++:A+=B}if(T=A.trim(),T==="")return}else v||(s+='<div class="song-section"><div class="section-label"></div><div class="section-content">',v=!0);if(T.includes("[")){s+='<div class="chord-line">';const u=T.split(/\[(.*?)\]/);u[0]&&(s+=`<div class="chord-pair"><div class="chord"></div><div class="lyric">${u[0]}</div></div>`);for(let b=1;b<u.length;b+=2){const A=u[b],L=u[b+1]||"";s+=`<div class="chord-pair"><div class="chord">${A}</div><div class="lyric">${L}</div></div>`}s+="</div>"}else s+=`<div class="lyric-line">${T}</div>`}),v&&(s+="</div></div>");const x=window.open("","_blank");if(!x){alert("Por favor, permite las ventanas emergentes (pop-ups) para imprimir.");return}x.document.write(`
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <title>${r} - Acordes</title>
    <link href="https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,500;0,700;0,800;1,500&display=swap" rel="stylesheet">
    <style>
      body { font-family: 'Montserrat', Arial, sans-serif; color: black; background: white; margin: 0; padding: 0; }
      
      header { border-bottom: 3px solid black; display: flex; justify-content: space-between; align-items: flex-start; }
      .header-left h1 { font-weight: 800; text-transform: uppercase; margin: 0; letter-spacing: -0.5px; }
      .header-left h2 { font-weight: 500; font-style: italic; color: #444; margin: 4px 0 0 0; }
      .header-right { text-align: right; font-weight: 800; }
      .header-right div { margin-bottom: 4px; }
      
      .song-section { display: flex; width: 100%; page-break-inside: avoid; }
      .section-label { font-weight: 800; flex-shrink: 0; padding-right: 15px; letter-spacing: 0.5px; }
      .section-content { flex-grow: 1; display: flex; flex-direction: column; overflow: hidden; }
      
      .chord-line { display: flex; flex-wrap: wrap; align-items: flex-end; margin-bottom: 4px; }
      .chord-pair { display: inline-flex; flex-direction: column; justify-content: flex-end; margin-right: 2px; }
      
      .chord { font-weight: 800; min-height: 14px; margin-bottom: 1px; color: #000; }
      .lyric { font-weight: 500; white-space: pre; color: #111; }
      .lyric-line { font-weight: 500; margin-bottom: 4px; white-space: pre-wrap; color: #111; }
      .spacer { height: 14px; }
      
      /* CSS Dinámico Inyectado por JS */
      ${k}
    </style>
  </head>
  <body>
    <header>
      <div class="header-left">
        <h1>${r}</h1>
        ${l?`<h2>${l}</h2>`:""}
      </div>
      <div class="header-right">
        ${d?`<div>Tonalidad de ${d}</div>`:""}
        ${f?`<div>${f}</div>`:""}
      </div>
    </header>
    <main>${s}</main>
  </body>
</html>
            `),x.document.close(),x.focus(),setTimeout(()=>{x.print(),x.close()},1e3)})});
