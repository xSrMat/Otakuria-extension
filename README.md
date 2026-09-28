# 🧩 Otakuria Companion - Extensión Oficial de Navegador

Extensión oficial para navegadores Chromium (Chrome, Brave, Edge, Opera) diseñada para conectar directamente tu navegador con la plataforma web de **[Otakuria](https://github.com/xSrMat/otakuria-website)**.

---

## 📦 Descarga Directa (.ZIP)

Puedes descargar la extensión lista para usar con un solo clic:

👉 **[Descargar otakuria-companion-v1.0.0.zip](https://github.com/xSrMat/Otakuria-extension/raw/main/otakuria-companion-v1.0.0.zip)**

*(También puedes hacer clic directamente en el archivo `otakuria-companion-v1.0.0.zip` en la lista de archivos de este repositorio y presionar el botón **Download**).*

---

## 🚀 Guía de Instalación Rápida (Chrome, Brave, Edge, Opera)

Instalar la extensión toma menos de 1 minuto siguiendo estos sencillos pasos:

### 1️⃣ Descargar y Descomprimir
1. Descarga el archivo [`otakuria-companion-v1.0.0.zip`](https://github.com/xSrMat/Otakuria-extension/raw/main/otakuria-companion-v1.0.0.zip).
2. Haz clic derecho sobre el archivo descargado y selecciona **"Extraer todo..."** (o utiliza tu descompresor preferido como 7-Zip / WinRAR).
3. Guarda la carpeta extraída en un lugar seguro (por ejemplo, en tus Documentos o en una carpeta de herramientas).  
   > ⚠️ **Importante:** No borres ni muevas esa carpeta después de instalarla, ya que el navegador la cargará desde esa ubicación.

### 2️⃣ Abrir la página de extensiones de tu navegador
Abre una pestaña nueva y escribe en la barra de direcciones según tu navegador:
- **Google Chrome:** `chrome://extensions/`
- **Brave Browser:** `brave://extensions/`
- **Microsoft Edge:** `edge://extensions/`
- **Opera / Opera GX:** `opera://extensions/`

### 3️⃣ Activar el Modo de Desarrollador
- En la esquina superior derecha, activa la casilla o interruptor llamado **"Modo de desarrollador"** (Developer mode).

### 4️⃣ Cargar la Extensión
1. Haz clic en el botón **"Cargar descomprimida"** (Load unpacked) que aparecerá en la parte superior izquierda.
2. Selecciona la carpeta que descomprimiste en el **Paso 1** (la carpeta donde se encuentra directamente el archivo `manifest.json`).
3. ¡Listo! Verás la extensión **Otakuria Companion** instalada y lista en tu lista de extensiones.

### 5️⃣ Conectar con Otakuria
- Entra o recarga la web de **Otakuria**. La plataforma detectará la extensión en tiempo real y habilitará todas las capacidades de lectura directa y sincronización.

---

## ✨ ¿Qué hace Otakuria Companion?

- ⚡ **Conexión Directa y sin Bloqueos:** Realiza peticiones a fuentes de lectura directamente desde tu navegador para máxima velocidad, evitando problemas de CORS y bloqueos de red intermediarios.
- 🔄 **Sincronización Transparente:** Mantiene comunicada la aplicación web de Otakuria con tu navegador sin configuraciones complejas.
- 🔒 **Privacidad Total:** Tus peticiones se ejecutan directamente en tu navegador; no se envían datos a servidores externos innecesarios.
- 🪶 **Ligera y Segura:** Diseñada sobre el estándar moderno **Manifest V3**, consumiendo un mínimo impacto en memoria RAM y CPU.

---

## 🛠️ Para Desarrolladores

Si deseas clonar el código fuente y modificarlo:

```bash
git clone https://github.com/xSrMat/Otakuria-extension.git
cd Otakuria-extension
```

Una vez realizados los cambios en los archivos (`content.js`, `background.js`, `popup.html`, etc.), simplemente ve a `chrome://extensions/` y haz clic en el icono de recargar 🔄 en la tarjeta de la extensión.
