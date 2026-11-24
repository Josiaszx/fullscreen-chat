# Twitch Glass Chat (prototipo)

Muestra el chat de Twitch como una ventana de cristal semitransparente dentro del reproductor,
también en pantalla completa.

## Instalar
1. Abre `chrome://extensions` y activa **Modo de desarrollador**.
2. **Cargar descomprimida** y elige esta carpeta.
3. Entra a un directo en `twitch.tv/<canal>`.

## Uso
- Arrastra la barra superior para mover; la esquina inferior derecha redimensiona.
- El área de escritura (input, puntos del canal, ajustes y enviar) está oculta por defecto; se despliega con el botón "Escribir" de la parte inferior del chat.
- Botón ☀ de la barra superior: abre un panel con la opacidad del cristal y el desenfoque.
  El desenfoque está **apagado por defecto** porque desenfocar el vídeo en cada fotograma
  penaliza el rendimiento del stream; súbelo solo si tu equipo lo aguanta.
- El chat solo funciona en **pantalla completa**: al salir se desactiva y hay que activarlo de nuevo al volver a entrar.
- Botón de chat 💬 en la barra de controles del reproductor (junto a pantalla completa, solo visible en fullscreen): activa/desactiva el chat.
- **Alt+C**: ocultar/mostrar (igual que el botón del reproductor).
- Posición, tamaño y opciones se guardan en `chrome.storage`.

## Archivos
- `content.js` / `content.css`: la ventana, el arrastre y el montaje en el reproductor o en el elemento fullscreen.
- `embedded.js` / `embedded.css`: hacen transparente el chat dentro del iframe.

## Notas
- Usa el chat popout (`/popout/<canal>/chat`).
- Las extensiones de emotes (7TV/BTTV) no se ejecutan dentro del iframe, así que `embedded.js` carga los emotes
  globales y del canal de 7TV y BTTV (vía `background.js`) y sustituye las palabras por imágenes.
  También carga FFZ (`api.frankerfacez.com`). El id del canal se obtiene de `api.ivr.fi`.
  No incluye emotes de ancho cero superpuestos.
- Al entrar/salir de fullscreen el iframe puede recargarse y el chat se reconecta.
- Si algo del chat se ve opaco, añade su clase a `embedded.css`.
