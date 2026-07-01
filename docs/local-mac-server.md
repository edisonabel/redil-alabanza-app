# Servidor local en Mac

Este modo permite usar un Mac como servidor local de Redil Alabanza y abrir la app desde celulares, tablets u otro computador conectado a la misma red Wi-Fi.

## Probar en este Mac

1. Instala dependencias si hace falta:

   ```bash
   npm install
   ```

2. Arranca la app escuchando en la red local:

   ```bash
   npm run dev:lan
   ```

3. En otra terminal, mira la URL local del Mac:

   ```bash
   npm run local:url
   ```

4. Abre esa URL desde el celular, por ejemplo:

   ```text
   http://192.168.1.20:4321/
   ```

El celular y el Mac deben estar en la misma red Wi-Fi. Si no abre, revisa que macOS no este bloqueando conexiones entrantes para Node o Astro.

## Acceso directo en el Escritorio

En este Mac hay un acceso directo creado en:

```text
/Users/edisonaular/Desktop/Redil Alabanza Local.command
```

Con doble clic hace esto:

- Entra al proyecto.
- Arranca el servidor local si esta apagado.
- Si ya esta prendido, no duplica el servidor.
- Abre la URL local en el navegador.
- Muestra consumo aproximado de memoria y CPU del servidor cada 10 segundos.

La ventana debe quedar abierta mientras se use la app. Para apagarlo, cierra la ventana o presiona `Ctrl+C`.

El monitor aparece en la Terminal con una linea parecida a esta:

```text
[13:07:57] MONITOR servidor: memoria 1436.8 MB | CPU 0.0% | procesos 3
```

Esto mide el servidor Node/Astro que corre en el Mac. El consumo de Safari, Chrome u otro navegador se revisa aparte en Monitor de Actividad de macOS.

El comando interno es:

```bash
npm run local:start
```

Si aparece un error de multitrack como `Load failed`, recarga la pagina o presiona "REINTENTAR CARGA". La app ahora muestra el nombre de la pista que fallo y desde que fuente intento cargarla, para poder distinguir entre archivo sin permisos, problema de red, CORS/proxy o formato de audio.

## Modo mas estable para ensayos

Para un ensayo o reunion donde no quieres recarga de desarrollo, usa:

```bash
npm run build
npm run preview:lan
npm run local:url
```

`dev:lan` sirve para desarrollar. `preview:lan` sirve para probar algo mas parecido a produccion.

## Usarlo con iPhone sin App Store

Para probar la interfaz sin la limitacion de firma de 7 dias, abre la URL local en Safari. Si la app esta preparada como PWA, puedes usar "Agregar a pantalla de inicio".

Para probar la app nativa de Capacitor en iPhone, Xcode sigue requiriendo firma. Con Apple ID gratis puede caducar; con Apple Developer pago puedes usar TestFlight o distribucion formal.

## Replicar en otro Mac de la iglesia

1. Instala herramientas:

   - Node.js LTS.
   - Git.
   - Xcode solo si tambien van a compilar/probar iOS nativo.
   - Android Studio solo si tambien van a compilar/probar Android.

2. Copia o clona el proyecto en el otro Mac.

3. Crea el archivo `.env` usando `.env.example` como base y copia los valores reales de Supabase, R2, notificaciones y registro.

4. Instala y prueba:

   ```bash
   npm install
   npm run local:start
   ```

5. En los celulares de la iglesia, abre la URL que muestre la ventana.

6. Crea el acceso directo en el Escritorio de ese Mac con este contenido, ajustando la ruta si el proyecto queda en otra carpeta:

   ```bash
   #!/bin/zsh
   cd "/RUTA/AL/PROYECTO/redil-alabanza-app" || exit 1
   npm run local:start
   ```

   Despues dale permiso de ejecucion:

   ```bash
   chmod +x "/Users/USUARIO/Desktop/Redil Alabanza Local.command"
   ```

## Recomendaciones para que no cambie la URL

En el router de la iglesia, reserva una IP fija para el Mac servidor. Asi la URL local puede mantenerse igual, por ejemplo:

```text
http://192.168.1.50:4321/
```

Si la red Wi-Fi tiene aislamiento de clientes activado, los celulares no podran ver el Mac. Hay que desactivar esa opcion o usar una red dedicada para el equipo.
