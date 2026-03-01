document.addEventListener("DOMContentLoaded",()=>{const R=["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"],S={Db:"C#",Eb:"D#",Gb:"F#",Ab:"G#",Bb:"A#"},h=document.getElementById("input-chordpro"),T=document.getElementById("output-chordpro"),z=document.getElementById("btn-subir"),j=document.getElementById("btn-bajar"),D=document.getElementById("btn-reset"),G=document.getElementById("btn-copiar"),M=document.getElementById("btn-autoconvertir");let p=0,I="";function P(n){if(n.trim().length===0)return!1;const e=/^[A-G][#b]?(m|maj|min|sus|dim|aug|[0-9])*(?:\/[A-G][#b]?)?$/i,i=n.trim().split(/\s+/),t=i.filter(l=>e.test(l));return i.length>0&&t.length/i.length>=.6}function U(n){const e=n.split(`
`);let i=[],t=0;for(;t<e.length;){const l=e[t],a=t+1<e.length?e[t+1]:null;if(P(l)){const m=/([A-G][^\s]*)/g;let b;const d=[];for(;(b=m.exec(l))!==null;)d.push({acorde:b[1],index:b.index});if(a!==null&&!P(a)&&a.trim().length>0){let o=a.trimEnd();for(let s=d.length-1;s>=0;s--){const{acorde:g,index:c}=d[s];c>o.length&&(o=o.padEnd(c," ")),o=o.slice(0,c)+`[${g}]`+o.slice(c)}i.push(o),t+=2}else{let o=l;for(let s=d.length-1;s>=0;s--){const{acorde:g,index:c}=d[s];o=o.slice(0,c)+`[${g}]`+o.slice(c+g.length)}i.push(o),t++}}else i.push(l),t++}return i.join(`
`)}function H(n,e){const i=n.match(/^([A-G][#b]?)(.*)$/);if(!i)return n;let t=i[1];const l=i[2];S[t]&&(t=S[t]);const a=R.indexOf(t);if(a===-1)return n;let m=(a+e)%12;return m<0&&(m+=12),R[m]+l}function A(){if(!h||!T)return;const n=I||h.value;if(p===0){T.value=n;return}const e=/\[(.*?)\]/g;T.value=n.replace(e,(i,t)=>"["+H(t,p)+"]")}z&&z.addEventListener("click",()=>{p++,A()}),j&&j.addEventListener("click",()=>{p--,A()}),D&&D.addEventListener("click",()=>{p=0,A()}),h&&h.addEventListener("input",()=>{I="",p=0,A()}),M&&h&&M.addEventListener("click",()=>{h.value.trim()!==""&&(I=U(h.value),p=0,A())}),G&&T&&G.addEventListener("click",async n=>{try{await navigator.clipboard.writeText(T.value);const e=n.currentTarget,i=e.innerHTML;e.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg> ¡Copiado!',e.classList.replace("bg-blue-600","bg-emerald-600"),e.classList.replace("hover:bg-blue-500","hover:bg-emerald-500"),setTimeout(()=>{e.innerHTML=i,e.classList.replace("bg-emerald-600","bg-blue-600"),e.classList.replace("hover:bg-emerald-500","hover:bg-blue-500")},2e3)}catch{alert("Error al copiar al portapapeles")}}),document.getElementById("btn-imprimir")?.addEventListener("click",()=>{const n=document.getElementById("print-titulo"),e=document.getElementById("print-artista"),i=document.getElementById("print-tono"),t=document.getElementById("print-bpm"),l=n?.value.trim()||"SIN TÍTULO",a=e?.value.trim()||"",m=i?.value.trim()||"",b=t?.value.trim()||"",d=document.getElementById("output-chordpro")?.value,o=document.getElementById("input-chordpro")?.value;let s=d&&d.trim()!==""?d:o||"";!s.includes("[")&&typeof window.autoConvertirAChordPro=="function"&&(s=window.autoConvertirAChordPro(s));const g=s.split(`
`),c=g.length;let k="16px",C="15mm 20mm";c>35&&(k="14px",C="12mm 15mm"),c>55&&(k="11.5px",C="10mm 12mm"),c>75&&(k="9.5px",C="8mm 10mm");let r="",x=!1;g.forEach($=>{if($.trim()===""){x&&(r+='<div class="spacer"></div>');return}const F=$.replace(/\[.*?\]/g,"").trim(),V=/^(VERSO\s*\d*|CORO\s*\d*|PUENTE\s*\d*|INTRO\s*\d*|OUTRO|FINAL|PRE-CORO|PRECORO|ESTR|INSTRUMENTAL|TAG)[\s\:\-]*(.*)$/i,O=F.match(V);let f=$;if(O){x&&(r+="</div></div>");const v=O[1].toUpperCase(),w=O[2];r+=`<div class="song-section"><div class="section-label">${v}</div><div class="section-content">`,x=!0;let B="",L=!1,N=0,W=F.length-w.length;for(let E=0;E<$.length;E++){let u=$[E];u==="["&&(L=!0),L?(B+=u,u==="]"&&(L=!1)):N<W?N++:B+=u}if(f=B.trim(),f==="")return;if(/^(\s*\[.*?\]\s*)+$/.test(f)){r+='<div class="chord-line">';const E=f.split(/\[(.*?)\]/);for(let u=1;u<E.length;u+=2)r+=`<div class="chord-pair"><div class="chord">${E[u]}</div><div class="lyric"> </div></div>`;r+="</div>";return}}else x||(r+='<div class="song-section"><div class="section-label"></div><div class="section-content">',x=!0);if(f.includes("[")){r+='<div class="chord-line">';const v=f.split(/\[(.*?)\]/);v[0]&&(r+=`<div class="chord-pair"><div class="chord"></div><div class="lyric">${v[0]}</div></div>`);for(let w=1;w<v.length;w+=2){const B=v[w],L=v[w+1]||"";r+=`<div class="chord-pair"><div class="chord">${B}</div><div class="lyric">${L}</div></div>`}r+="</div>"}else r+=`<div class="lyric-line">${f}</div>`}),x&&(r+="</div></div>");const y=window.open("","_blank");if(!y){alert("Por favor, permite las ventanas emergentes (pop-ups) para imprimir.");return}y.document.write(`
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <title>${l} - Acordes</title>
    <link href="https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,500;0,700;0,800;1,500&display=swap" rel="stylesheet">
    <style>
      html { font-size: ${k}; }
      @page { margin: 0; size: letter; }
      body { font-family: 'Montserrat', Arial, sans-serif; color: black; background: white; margin: 0; padding: ${C}; box-sizing: border-box; }
      
      header { border-bottom: 0.2rem solid black; display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 2rem; padding-bottom: 0.5rem; }
      .header-left h1 { font-weight: 800; font-size: 2.2rem; text-transform: uppercase; margin: 0; letter-spacing: -0.02rem; }
      .header-left h2 { font-weight: 500; font-style: italic; color: #444; margin: 0.3rem 0 0 0; }
      .header-right { text-align: right; font-weight: 800; font-size: 1rem; }
      .header-right div { margin-bottom: 0.2rem; }
      
      .song-section { display: flex; width: 100%; page-break-inside: avoid; margin-bottom: 1.5rem; }
      .section-label { font-weight: 800; font-size: 0.95rem; width: 8.5rem; flex-shrink: 0; padding-right: 1rem; }
      .section-content { flex-grow: 1; display: flex; flex-direction: column; overflow: hidden; }
      
      .chord-line { display: flex; flex-wrap: wrap; align-items: flex-end; margin-bottom: 0.3rem; }
      .chord-pair { display: inline-flex; flex-direction: column; justify-content: flex-end; margin-right: 0.15rem; }
      
      .chord { font-weight: 800; font-size: 0.9rem; min-height: 1rem; margin-bottom: 0.1rem; color: #000; }
      .lyric { font-weight: 500; font-size: 1.1rem; white-space: pre; color: #111; }
      .lyric-line { font-weight: 500; font-size: 1.1rem; margin-bottom: 0.3rem; white-space: pre-wrap; color: #111; }
      .spacer { height: 1rem; }
    </style>
  </head>
  <body>
    <header>
      <div class="header-left">
        <h1>${l}</h1>
        ${a?`<h2>${a}</h2>`:""}
      </div>
      <div class="header-right">
        ${m?`<div>Tonalidad de ${m}</div>`:""}
        ${b?`<div>${b}</div>`:""}
      </div>
    </header>
    <main>${r}</main>
  </body>
</html>
            `),y.document.close(),y.focus(),setTimeout(()=>{y.print(),y.close()},1200)})});
