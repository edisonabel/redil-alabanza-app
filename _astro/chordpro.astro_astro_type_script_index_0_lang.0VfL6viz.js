document.addEventListener("DOMContentLoaded",()=>{const k=["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"],L={Db:"C#",Eb:"D#",Gb:"F#",Ab:"G#",Bb:"A#"},m=document.getElementById("input-chordpro"),b=document.getElementById("output-chordpro"),B=document.getElementById("btn-subir"),$=document.getElementById("btn-bajar"),C=document.getElementById("btn-reset"),O=document.getElementById("btn-copiar"),S=document.getElementById("btn-autoconvertir");let p=0,A="";function R(o){if(o.trim().length===0)return!1;const t=/^[A-G][#b]?(m|maj|min|sus|dim|aug|[0-9])*(?:\/[A-G][#b]?)?$/i,i=o.trim().split(/\s+/),n=i.filter(s=>t.test(s));return i.length>0&&n.length/i.length>=.6}function j(o){const t=o.split(`
`);let i=[],n=0;for(;n<t.length;){const s=t[n],l=n+1<t.length?t[n+1]:null;if(R(s)){const c=/([A-G][^\s]*)/g;let h;const a=[];for(;(h=c.exec(s))!==null;)a.push({acorde:h[1],index:h.index});if(l!==null&&!R(l)&&l.trim().length>0){let r=l.trimEnd();for(let d=a.length-1;d>=0;d--){const{acorde:g,index:e}=a[d];e>r.length&&(r=r.padEnd(e," ")),r=r.slice(0,e)+`[${g}]`+r.slice(e)}i.push(r),n+=2}else{let r=s;for(let d=a.length-1;d>=0;d--){const{acorde:g,index:e}=a[d];r=r.slice(0,e)+`[${g}]`+r.slice(e+g.length)}i.push(r),n++}}else i.push(s),n++}return i.join(`
`)}function z(o,t){const i=o.match(/^([A-G][#b]?)(.*)$/);if(!i)return o;let n=i[1];const s=i[2];L[n]&&(n=L[n]);const l=k.indexOf(n);if(l===-1)return o;let c=(l+t)%12;return c<0&&(c+=12),k[c]+s}function x(){if(!m||!b)return;const o=A||m.value;if(p===0){b.value=o;return}const t=/\[(.*?)\]/g;b.value=o.replace(t,(i,n)=>"["+z(n,p)+"]")}B&&B.addEventListener("click",()=>{p++,x()}),$&&$.addEventListener("click",()=>{p--,x()}),C&&C.addEventListener("click",()=>{p=0,x()}),m&&m.addEventListener("input",()=>{A="",p=0,x()}),S&&m&&S.addEventListener("click",()=>{m.value.trim()!==""&&(A=j(m.value),p=0,x())}),O&&b&&O.addEventListener("click",async o=>{try{await navigator.clipboard.writeText(b.value);const t=o.currentTarget,i=t.innerHTML;t.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg> ¡Copiado!',t.classList.replace("bg-blue-600","bg-emerald-600"),t.classList.replace("hover:bg-blue-500","hover:bg-emerald-500"),setTimeout(()=>{t.innerHTML=i,t.classList.replace("bg-emerald-600","bg-blue-600"),t.classList.replace("hover:bg-emerald-500","hover:bg-blue-500")},2e3)}catch{alert("Error al copiar al portapapeles")}}),document.getElementById("btn-imprimir")?.addEventListener("click",()=>{const o=document.getElementById("print-titulo"),t=document.getElementById("print-artista"),i=document.getElementById("print-tono"),n=document.getElementById("print-bpm"),s=o?.value.trim()||"SIN TÍTULO",l=t?.value.trim()||"",c=i?.value.trim()||"",h=n?.value.trim()||"",a=document.getElementById("output-chordpro"),r=document.getElementById("input-chordpro"),g=(a&&a.value.trim()!==""?a.value:r?r.value:"").split(`
`);let e="",f=!1;g.forEach(E=>{if(E.trim()===""){f&&(e+='<div class="spacer"></div>');return}const G=E.match(/^(\[.*?\]\s*)*/),T=G?G[0]:"",D=E.substring(T.length),M=/^(VERSO\s*\d*|CORO\s*\d*|PUENTE\s*\d*|INTRO\s*\d*|OUTRO|FINAL|PRE-CORO|PRECORO|ESTR|INSTRUMENTAL|TAG)[\s:-]*(.*)$/i,I=D.match(M);let v=E;if(I){f&&(e+="</div></div>");const u=I[1].toUpperCase();if(e+='<div class="song-section">',e+=`<div class="section-label">${u}</div>`,e+='<div class="section-content">',f=!0,v=T+I[2].trim(),v.trim()===""||v.trim()===T.trim())return}else f||(e+='<div class="song-section">',e+='<div class="section-label"></div>',e+='<div class="section-content">',f=!0);if(v.includes("[")){e+='<div class="chord-line">';const u=v.split(/\[(.*?)\]/);u[0]&&(e+=`<div class="chord-pair"><div class="chord"></div><div class="lyric">${u[0]}</div></div>`);for(let w=1;w<u.length;w+=2){const N=u[w],P=u[w+1]||"";e+=`<div class="chord-pair">
                                       <div class="chord">${N}</div>
                                       <div class="lyric">${P}</div>
                                     </div>`}e+="</div>"}else e+=`<div class="lyric-line">${v}</div>`}),f&&(e+="</div></div>");const y=window.open("","_blank","height=800,width=800");if(!y){alert("Por favor, permite las ventanas emergentes (pop-ups) para imprimir.");return}y.document.write(`
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>${s}</title>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap');
      
      @page { margin: 15mm 20mm; size: letter; }
      body { 
          font-family: Arial, Helvetica, sans-serif; 
          color: black; 
          background: white; 
          margin: 0; 
          padding: 20px; 
      }
      
      /* Cabecera Sovereign Grace */
      header { border-bottom: 2px solid black; padding-bottom: 12px; margin-bottom: 25px; display: flex; justify-content: space-between; align-items: flex-start; }
      .header-left h1 { font-size: 26px; font-weight: 900; text-transform: uppercase; margin: 0; letter-spacing: 0.5px; }
      .header-left h2 { font-size: 15px; font-weight: normal; font-style: italic; color: #333; margin: 4px 0 0 0; }
      .header-right { text-align: right; font-size: 14px; font-weight: bold; }
      .header-right div { margin-bottom: 4px; }
      
      /* Columnas */
      .song-section { display: flex; width: 100%; margin-bottom: 20px; page-break-inside: avoid; }
      .section-label { width: 130px; font-weight: bold; font-size: 13px; flex-shrink: 0; padding-right: 15px; text-transform: uppercase; }
      .section-content { flex-grow: 1; display: flex; flex-direction: column; }
      
      /* Acordes sobre Letra */
      .chord-line { display: flex; flex-wrap: wrap; align-items: flex-end; margin-bottom: 4px; }
      .chord-pair { display: inline-flex; flex-direction: column; justify-content: flex-end; align-items: flex-start; }
      .chord { font-weight: bold; font-size: 13px; min-height: 14px; margin-bottom: 1px; color: black; }
      .lyric { font-size: 15px; white-space: pre; min-height: 16px; color: black; }
      .lyric-line { font-size: 15px; margin-bottom: 4px; min-height: 16px; white-space: pre-wrap; color: black; }
      .spacer { height: 12px; }
    </style>
</head>
<body>
    <header>
      <div class="header-left">
        <h1>${s}</h1>
        ${l?`<h2>${l}</h2>`:""}
      </div>
      <div class="header-right">
        ${c?`<div>Tonalidad: ${c}</div>`:""}
        ${h?`<div>${h}</div>`:""}
      </div>
    </header>
    <main>
      ${e}
    </main>
</body>
</html>
            `),y.document.close(),y.focus(),setTimeout(()=>{y.print()},500)})});
