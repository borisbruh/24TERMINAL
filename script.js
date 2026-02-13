//script.js

// ===============================
// DOM REFERENCES
// ===============================
const viewport = document.getElementById("viewport");
const radar = document.getElementById("radar");
const sweep = document.getElementById("sweep");
const ringsContainer = document.getElementById("rings");

// ===============================
// WORLD BOUNDS
// ===============================
const WORLD_MIN_X = -50000;
const WORLD_MAX_X = 50000;
const WORLD_MIN_Y = -50000;
const WORLD_MAX_Y = 50000;

const RADAR_SIZE = 1024;

// ===============================
// ZOOM + PAN STATE
// ===============================
let scale = 1;
let translateX = 0;
let translateY = 0;

let isPanning = false;
let startX = 0;
let startY = 0;

// ===============================
// RADAR ENGINE STATE
// ===============================
let planeElements = {};
let liveData = {};
let planeAngles = {};
let sweepAngle = -110;

const SWEEP_DURATION = 10000; // full rotation in ms
const BEAM_WIDTH = 16;
const SWEEP_OFFSET = 75; // align JS angle with CSS
const PING_ALIVE_TIME = 0.005; // the lower, the longer

let lastTime = performance.now();
let lastDetection = 0;

// ===============================
// FETCH DATA
// ===============================
async function fetchPlanes() {
  const response = await fetch("/api/planes");
  return await response.json();
}

function computePlaneAngles() {
  planeAngles = {};
  Object.entries(liveData).forEach(([flightName, data]) => {
    const { x, y } = data.position;
    const { screenX, screenY } = worldToScreen(x, y);
    planeAngles[flightName] = {
      screenX,
      screenY,
      angle: getAngleFromCenter(screenX, screenY),
      data
    };
  });
}

async function updateRadarData() {
  try {
    liveData = await fetchPlanes();
    computePlaneAngles();
  } catch (err) {
    console.error(err);
  }
}

setInterval(updateRadarData, 5000);
updateRadarData();

// ===============================
// WORLD → SCREEN
// ===============================
function worldToScreen(x, y) {
  const screenX =
    ((x - WORLD_MIN_X) / (WORLD_MAX_X - WORLD_MIN_X)) * RADAR_SIZE;

  const screenY =
    ((y - WORLD_MIN_Y) / (WORLD_MAX_Y - WORLD_MIN_Y)) * RADAR_SIZE;

  return { screenX, screenY };
}

function getAngleFromCenter(x, y) {
  const center = RADAR_SIZE / 2;
  const dx = x - center;
  const dy = y - center;

  let angle = Math.atan2(dy, dx) * (180 / Math.PI);
  if (angle < 0) angle += 360;
  return angle;
}

// ===============================
// RANGE RINGS + LINES
// ===============================
function createRings() {
  const ringCount = 7;

  for (let i = 1; i <= ringCount; i++) {
    const ring = document.createElement("div");
    ring.className = "ring";

    const size = (RADAR_SIZE / ringCount) * i;

    ring.style.width = `${size}px`;
    ring.style.height = `${size}px`;
    ring.style.left = `${(RADAR_SIZE - size) / 2}px`;
    ring.style.top = `${(RADAR_SIZE - size) / 2}px`;

    ringsContainer.appendChild(ring);
  }
}

createRings();


function createRadialLines() {
  const radarEl = document.getElementById("radar");

  for (let i = 0; i < 12; i++) {
    const line = document.createElement("div");
    line.className = "radar-line";
    line.style.transform = `rotate(${i * 30}deg)`;
    radarEl.appendChild(line);
  }
}

createRadialLines();



// ===============================
// DETECTION
// ===============================
function detectHits() {
  Object.entries(planeAngles).forEach(([flightName, obj]) => {
    const { screenX, screenY, angle, data } = obj;

    let diff = Math.abs(angle - sweepAngle);
    if (diff > 180) diff = 360 - diff;

    if (diff < BEAM_WIDTH) {
      let plane = planeElements[flightName];
      if (!plane) {
        plane = document.createElement("div");
        plane.className = "plane";
        radar.appendChild(plane);
        planeElements[flightName] = plane;
      }


      plane.style.left = `${screenX}px`;
      plane.style.top = `${screenY}px`;
      plane.style.opacity = 0.75;
        

        // color
        if (data.isEmergencyOccuring) {
          plane.style.background = "red";
          plane.style.boxShadow = "0 0 10px red";
        } else if (data.isOnGround) {
          plane.style.background = "#00aaff";
          plane.style.boxShadow = "0 0 10px #00aaff";
        } else {
          plane.style.background = "#ffffff";
          plane.style.boxShadow = "0 0 10px #00ff00";
        }
    }
  });
}

// ===============================
// RADAR ENGINE
// ===============================

function radarEngine(now) {
	const delta = now - lastTime;
	lastTime = now;

	const degreesPerMs = 360 / SWEEP_DURATION;
	sweepAngle += delta * degreesPerMs;
	if (sweepAngle >= 360) sweepAngle -= 360;

	sweep.style.transform = `rotate(${sweepAngle + SWEEP_OFFSET}deg)`;

	// fade planes (cheap)
	Object.values(planeElements).forEach((plane) => {
		let currentOpacity = parseFloat(plane.style.opacity) || 0;
		plane.style.opacity = Math.max(0, currentOpacity - PING_ALIVE_TIME);
	});

	// run detection every 50ms
	if (now - lastDetection > 50) {
	lastDetection = now;
	detectHits();
	updateClutter();
	}
	  
	const noise = (Math.random() * 0.04) + 0.98; // 0.98 → 1.02 brightness
	radar.style.filter = `brightness(${noise})`;
	
	

	requestAnimationFrame(radarEngine);
}

// START LOOP
requestAnimationFrame(radarEngine);

// ===============================
// TRANSFORM HANDLING
// ===============================
function updateTransform() {
  radar.style.transform =
    `translate(${translateX}px, ${translateY}px) scale(${scale})`;
}

// ===============================
// ZOOM
// ===============================
viewport.addEventListener("wheel", (e) => {
  e.preventDefault();
  const zoomSpeed = 0.1;
  if (e.deltaY < 0) scale += zoomSpeed;
  else scale -= zoomSpeed;

  scale = Math.max(0.5, Math.min(scale, 5));
  updateTransform();
});

// ===============================
// PAN (RIGHT CLICK)
// ===============================
viewport.addEventListener("contextmenu", (e) => e.preventDefault());

viewport.addEventListener("mousedown", (e) => {
  if (e.button === 2) {
    isPanning = true;
    startX = e.clientX - translateX;
    startY = e.clientY - translateY;
    viewport.style.cursor = "grabbing";
  }
});

window.addEventListener("mouseup", () => {
  isPanning = false;
  viewport.style.cursor = "grab";
});

window.addEventListener("mousemove", (e) => {
  if (!isPanning) return;
  translateX = e.clientX - startX;
  translateY = e.clientY - startY;
  updateTransform();
});


// ===================
// Clutter(funk)
// =================

const clutter = document.getElementById("clutter");

const CLUTTER_COUNT = 128;
const CLUTTER_BEAM = 6;  // degrees
const CLUTTER_COOLDOWN = 300; // ms between each dot activation

let clutterDots = [];

function initClutter() {
  for (let i = 0; i < CLUTTER_COUNT; i++) {
    const dot = document.createElement("div");
    dot.className = "clutter-dot";

    const x = Math.random() * RADAR_SIZE;
    const y = Math.random() * RADAR_SIZE;

    dot.dataset.x = x;
    dot.dataset.y = y;
    dot.dataset.last = 0; // last time it activated

    dot.style.left = `${x}px`;
    dot.style.top = `${y}px`;
    dot.style.opacity = 0;

    clutter.appendChild(dot);
    clutterDots.push(dot);
  }
}

initClutter(); // ONLY call once


function updateClutter() {
  const now = performance.now();

  clutterDots.forEach((dot) => {
    const x = parseFloat(dot.dataset.x);
    const y = parseFloat(dot.dataset.y);

    const angle = getAngleFromCenter(x, y);

    let diff = Math.abs(angle - sweepAngle);
    if (diff > 180) diff = 360 - diff;

    // only activate when sweep is close
    if (diff < CLUTTER_BEAM) {
      // prevent it from flashing constantly
      if (now - dot.dataset.last > CLUTTER_COOLDOWN) {
        dot.dataset.last = now;
        dot.style.opacity = 1;

        // fade out fast
        setTimeout(() => {
          dot.style.opacity = 0;
        }, 70);
      }
    }
  });
}
