document.addEventListener("DOMContentLoaded",()=>{const I=["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"],C={Db:"C#",Eb:"D#",Gb:"F#",Ab:"G#",Bb:"A#"},u=document.getElementById("input-chordpro"),w=document.getElementById("output-chordpro"),O=document.getElementById("btn-subir"),R=document.getElementById("btn-bajar"),S=document.getElementById("btn-reset"),j=document.getElementById("btn-copiar"),D=document.getElementById("btn-autoconvertir");let h=0,B="";function z(o){if(o.trim().length===0)return!1;const t=/^[A-G][#b]?(m|maj|min|sus|dim|aug|[0-9])*(?:\/[A-G][#b]?)?$/i,n=o.trim().split(/\s+/),i=n.filter(s=>t.test(s));return n.length>0&&i.length/n.length>=.6}function F(o){const t=o.split(`
`);let n=[],i=0;for(;i<t.length;){const s=t[i],l=i+1<t.length?t[i+1]:null;if(z(s)){const a=/([A-G][^\s]*)/g;let f;const c=[];for(;(f=a.exec(s))!==null;)c.push({acorde:f[1],index:f.index});if(l!==null&&!z(l)&&l.trim().length>0){let r=l.trimEnd();for(let d=c.length-1;d>=0;d--){const{acorde:v,index:e}=c[d];e>r.length&&(r=r.padEnd(e," ")),r=r.slice(0,e)+`[${v}]`+r.slice(e)}n.push(r),i+=2}else{let r=s;for(let d=c.length-1;d>=0;d--){const{acorde:v,index:e}=c[d];r=r.slice(0,e)+`[${v}]`+r.slice(e+v.length)}n.push(r),i++}}else n.push(s),i++}return n.join(`
`)}function N(o,t){const n=o.match(/^([A-G][#b]?)(.*)$/);if(!n)return o;let i=n[1];const s=n[2];C[i]&&(i=C[i]);const l=I.indexOf(i);if(l===-1)return o;let a=(l+t)%12;return a<0&&(a+=12),I[a]+s}function T(){if(!u||!w)return;const o=B||u.value;if(h===0){w.value=o;return}const t=/\[(.*?)\]/g;w.value=o.replace(t,(n,i)=>"["+N(i,h)+"]")}O&&O.addEventListener("click",()=>{h++,T()}),R&&R.addEventListener("click",()=>{h--,T()}),S&&S.addEventListener("click",()=>{h=0,T()}),u&&u.addEventListener("input",()=>{B="",h=0,T()}),D&&u&&D.addEventListener("click",()=>{u.value.trim()!==""&&(B=F(u.value),h=0,T())}),j&&w&&j.addEventListener("click",async o=>{try{await navigator.clipboard.writeText(w.value);const t=o.currentTarget,n=t.innerHTML;t.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg> ¡Copiado!',t.classList.replace("bg-blue-600","bg-emerald-600"),t.classList.replace("hover:bg-blue-500","hover:bg-emerald-500"),setTimeout(()=>{t.innerHTML=n,t.classList.replace("bg-emerald-600","bg-blue-600"),t.classList.replace("hover:bg-emerald-500","hover:bg-blue-500")},2e3)}catch{alert("Error al copiar al portapapeles")}}),document.getElementById("btn-imprimir")?.addEventListener("click",()=>{const o=document.getElementById("print-titulo"),t=document.getElementById("print-artista"),n=document.getElementById("print-tono"),i=document.getElementById("print-bpm"),s=o?.value.trim()||"SIN TÍTULO",l=t?.value.trim()||"",a=n?.value.trim()||"",f=i?.value.trim()||"",c=document.getElementById("output-chordpro"),r=document.getElementById("input-chordpro"),v=(c&&c.value.trim()!==""?c.value:r?r.value:"").split(`
`);let e="",b=!1;v.forEach(A=>{if(A.trim()===""){b&&(e+='<div class="spacer"></div>');return}const G=A.replace(/\[.*?\]/g,"").trim(),P=/^(VERSO\s*\d*|CORO\s*\d*|PUENTE\s*\d*|INTRO\s*\d*|OUTRO|FINAL|PRE-CORO|PRECORO|ESTR|INSTRUMENTAL|TAG)[\s\:\-]*(.*)$/i,L=G.match(P);let p=A;if(L){b&&(e+="</div></div>");const g=L[1].toUpperCase(),y=L[2];e+='<div class="song-section">',e+=`<div class="section-label">${g}</div>`,e+='<div class="section-content">',b=!0;let $="",k=!1,U=G.length-y.length,M=0;for(let E=0;E<A.length;E++){let m=A[E];m==="["&&(k=!0),k?($+=m,m==="]"&&(k=!1)):M>=U?$+=m:M++}if(p=$.trim(),p===""||/^(\[.*?\])+$/.test(p)){if(p!==""){e+='<div class="chord-line">';const E=p.split(/\[(.*?)\]/);for(let m=1;m<E.length;m+=2)e+=`<div class="chord-pair"><div class="chord">${E[m]}</div><div class="lyric"> </div></div>`;e+="</div>"}return}}else b||(e+='<div class="song-section"><div class="section-label"></div><div class="section-content">',b=!0);if(p.includes("[")){e+='<div class="chord-line">';const g=p.split(/\[(.*?)\]/);g[0]&&(e+=`<div class="chord-pair"><div class="chord"></div><div class="lyric">${g[0]}</div></div>`);for(let y=1;y<g.length;y+=2){const $=g[y],k=g[y+1]||"";e+=`<div class="chord-pair"><div class="chord">${$}</div><div class="lyric">${k}</div></div>`}e+="</div>"}else e+=`<div class="lyric-line">${p}</div>`}),b&&(e+="</div></div>");const x=window.open("","_blank","height=800,width=800");if(!x){alert("Por favor, permite las ventanas emergentes (pop-ups) para imprimir.");return}x.document.write(`
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <title>${s} - Acordes</title>
    <link href="https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,500;0,700;0,800;1,500&display=swap" rel="stylesheet">
    <style>
      @page { margin: 15mm 20mm; size: letter; }
      body { font-family: 'Montserrat', Arial, sans-serif; color: black; background: white; margin: 0; padding: 0; }
      
      header { border-bottom: 3px solid black; padding-bottom: 15px; margin-bottom: 35px; display: flex; justify-content: space-between; align-items: flex-start; }
      .header-left h1 { font-size: 32px; font-weight: 800; text-transform: uppercase; margin: 0; letter-spacing: -0.5px; }
      .header-left h2 { font-size: 18px; font-weight: 500; font-style: italic; color: #444; margin: 6px 0 0 0; }
      .header-right { text-align: right; font-size: 16px; font-weight: 700; }
      .header-right div { margin-bottom: 5px; }
      
      .song-section { display: flex; width: 100%; margin-bottom: 28px; page-break-inside: avoid; }
      .section-label { width: 140px; font-weight: 800; font-size: 15px; flex-shrink: 0; padding-right: 15px; letter-spacing: 0.5px; text-transform: uppercase; }
      .section-content { flex-grow: 1; display: flex; flex-direction: column; }
      
      .chord-line { display: flex; flex-wrap: wrap; align-items: flex-end; margin-bottom: 6px; }
      .chord-pair { display: inline-flex; flex-direction: column; justify-content: flex-end; }
      
      /* Jerarquía Visual Fuerte */
      .chord { font-weight: 800; font-size: 15px; min-height: 16px; margin-bottom: 2px; color: #000; }
      .lyric { font-weight: 500; font-size: 17px; white-space: pre; min-height: 18px; color: #111; }
      .lyric-line { font-weight: 500; font-size: 17px; margin-bottom: 6px; min-height: 18px; white-space: pre-wrap; color: #111; }
      .spacer { height: 18px; }
    </style>
  </head>
  <body>
    <header>
      <div class="header-left">
        <h1>${s}</h1>
        ${l?`<h2>${l}</h2>`:""}
      </div>
      <div class="header-right">
        ${a?`<div>Tonalidad: ${a}</div>`:""}
        ${f?`<div>${f}</div>`:""}
      </div>
    </header>
    <main>
      ${e}
    </main>
  </body>
</html>
            `),x.document.close(),x.focus(),setTimeout(()=>{x.print(),x.close()},1e3)})});
