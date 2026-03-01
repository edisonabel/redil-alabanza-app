document.addEventListener("DOMContentLoaded",()=>{const O=["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"],R={Db:"C#",Eb:"D#",Gb:"F#",Ab:"G#",Bb:"A#"},u=document.getElementById("input-chordpro"),x=document.getElementById("output-chordpro"),S=document.getElementById("btn-subir"),z=document.getElementById("btn-bajar"),M=document.getElementById("btn-reset"),j=document.getElementById("btn-copiar"),D=document.getElementById("btn-autoconvertir");let h=0,B="";function G(o){if(o.trim().length===0)return!1;const e=/^[A-G][#b]?(m|maj|min|sus|dim|aug|[0-9])*(?:\/[A-G][#b]?)?$/i,n=o.trim().split(/\s+/),t=n.filter(s=>e.test(s));return n.length>0&&t.length/n.length>=.6}function N(o){const e=o.split(`
`);let n=[],t=0;for(;t<e.length;){const s=e[t],a=t+1<e.length?e[t+1]:null;if(G(s)){const d=/([A-G][^\s]*)/g;let f;const p=[];for(;(f=d.exec(s))!==null;)p.push({acorde:f[1],index:f.index});if(a!==null&&!G(a)&&a.trim().length>0){let i=a.trimEnd();for(let c=p.length-1;c>=0;c--){const{acorde:m,index:r}=p[c];r>i.length&&(i=i.padEnd(r," ")),i=i.slice(0,r)+`[${m}]`+i.slice(r)}n.push(i),t+=2}else{let i=s;for(let c=p.length-1;c>=0;c--){const{acorde:m,index:r}=p[c];i=i.slice(0,r)+`[${m}]`+i.slice(r+m.length)}n.push(i),t++}}else n.push(s),t++}return n.join(`
`)}function U(o,e){const n=o.match(/^([A-G][#b]?)(.*)$/);if(!n)return o;let t=n[1];const s=n[2];R[t]&&(t=R[t]);const a=O.indexOf(t);if(a===-1)return o;let d=(a+e)%12;return d<0&&(d+=12),O[d]+s}function y(){if(!u||!x)return;const o=B||u.value;if(h===0){x.value=o;return}const e=/\[(.*?)\]/g;x.value=o.replace(e,(n,t)=>"["+U(t,h)+"]")}S&&S.addEventListener("click",()=>{h++,y()}),z&&z.addEventListener("click",()=>{h--,y()}),M&&M.addEventListener("click",()=>{h=0,y()}),u&&u.addEventListener("input",()=>{B="",h=0,y()}),D&&u&&D.addEventListener("click",()=>{u.value.trim()!==""&&(B=N(u.value),h=0,y())}),j&&x&&j.addEventListener("click",async o=>{try{await navigator.clipboard.writeText(x.value);const e=o.currentTarget,n=e.innerHTML;e.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg> ¡Copiado!',e.classList.replace("bg-blue-600","bg-emerald-600"),e.classList.replace("hover:bg-blue-500","hover:bg-emerald-500"),setTimeout(()=>{e.innerHTML=n,e.classList.replace("bg-emerald-600","bg-blue-600"),e.classList.replace("hover:bg-emerald-500","hover:bg-blue-500")},2e3)}catch{alert("Error al copiar al portapapeles")}}),document.getElementById("btn-imprimir")?.addEventListener("click",()=>{const o=document.getElementById("print-titulo"),e=document.getElementById("print-artista"),n=document.getElementById("print-tono"),t=document.getElementById("print-bpm"),s=o?.value.trim()||"SIN TÍTULO",a=e?.value.trim()||"",d=n?.value.trim()||"",f=t?.value.trim()||"",p=document.getElementById("input-chordpro")?.value||"";let i=document.getElementById("output-chordpro")?.value||p;i.includes("[")||typeof window.autoConvertirAChordPro=="function"&&(i=window.autoConvertirAChordPro(i));const c=i.split(`
`),m=c.length;let r="16px",$="15mm 20mm";m>35&&(r="14px",$="12mm 15mm"),m>55&&(r="11.5px",$="10mm 12mm"),m>75&&(r="9.5px",$="8mm 10mm");let l="",v=!1;c.forEach(E=>{if(E.trim()===""){v&&(l+='<div class="spacer"></div>');return}const P=E.replace(/\[.*?\]/g,"").trim(),H=/^(VERSO\s*\d*|CORO\s*\d*|PUENTE\s*\d*|INTRO\s*\d*|OUTRO|FINAL|PRE-CORO|PRECORO|ESTR|INSTRUMENTAL|TAG)[\s\:\-]*(.*)$/i,I=P.match(H);let T=E;if(I){v&&(l+="</div></div>");const g=I[1].toUpperCase(),w=I[2];l+=`<div class="song-section"><div class="section-label">${g}</div><div class="section-content">`,v=!0;let A="",L=!1,V=P.length-w.length,F=0;for(let C=0;C<E.length;C++){let k=E[C];k==="["&&(L=!0),L?(A+=k,k==="]"&&(L=!1)):F<V?F++:A+=k}if(T=A.trim(),T==="")return}else v||(l+='<div class="song-section"><div class="section-label"></div><div class="section-content">',v=!0);if(T.includes("[")){l+='<div class="chord-line">';const g=T.split(/\[(.*?)\]/);g[0]&&(l+=`<div class="chord-pair"><div class="chord"></div><div class="lyric">${g[0]}</div></div>`);for(let w=1;w<g.length;w+=2){const A=g[w],L=g[w+1]||"";l+=`<div class="chord-pair"><div class="chord">${A}</div><div class="lyric">${L}</div></div>`}l+="</div>"}else l+=`<div class="lyric-line">${T}</div>`}),v&&(l+="</div></div>");const b=window.open("","_blank");if(!b){alert("Por favor, permite las ventanas emergentes (pop-ups) para imprimir.");return}b.document.write(`
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <title>${s} - Acordes</title>
    <link href="https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,500;0,700;0,800;1,500&display=swap" rel="stylesheet">
    <style>
      html { font-size: ${r}; }
      @page { margin: ${$}; size: letter; }
      body { font-family: 'Montserrat', Arial, sans-serif; color: black; background: white; margin: 0; padding: 0; }
      
      header { border-bottom: 0.2rem solid black; display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 2rem; padding-bottom: 0.5rem; }
      .header-left h1 { font-weight: 800; font-size: 2.2rem; text-transform: uppercase; margin: 0; letter-spacing: -0.02rem; }
      .header-left h2 { font-weight: 500; font-size: 1.1rem; font-style: italic; color: #444; margin: 0.3rem 0 0 0; }
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
        <h1>${s}</h1>
        ${a?`<h2>${a}</h2>`:""}
      </div>
      <div class="header-right">
        ${d?`<div>Tonalidad de ${d}</div>`:""}
        ${f?`<div>${f}</div>`:""}
      </div>
    </header>
    <main>${l}</main>
  </body>
</html>
            `),b.document.close(),b.focus(),setTimeout(()=>{b.print(),b.close()},1200)})});
