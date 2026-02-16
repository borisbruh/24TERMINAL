/* script.js */

// ===============================
// DOM REFERENCES
// ===============================
const viewport = document.getElementById("viewport");
const radar = document.getElementById("radar");
const sweep = document.getElementById("sweep");
const ringsContainer = document.getElementById("rings");
const terminalOutput = document.getElementById("terminal-output");
const radarStats = document.getElementById("radar-stats");

// ===============================
// TERMINAL & PLANE SELECTION
// ===============================
let planeList = [];
let selectedPlaneIndex = 0;
let typingTimeout = null;
let SPED = 2;

// ===============================
// WORLD BOUNDS
// ===============================
const WORLD_MIN_X = -60000;
const WORLD_MAX_X = 60000;
const WORLD_MIN_Y = -60000;
const WORLD_MAX_Y = 60000;

const RADAR_SIZE = 1024;

// ===============================
// ZOOM + PAN STATE
// ===============================
let scale = 1;
let translateX = 0;
let translateY = 0;

let cameraTarget = { x: 0, y: 0 };
let trackMode = false;
let lastPingedPositions = {};


// ===============================
// RADAR ENGINE STATE
// ===============================
let planeElements = {};
let liveData = {};
let planeAngles = {};
let sweepAngle = -110;

let SWEEP_DURATION = 10000;
const BEAM_WIDTH = 2;
const SWEEP_OFFSET = 75;
let PING_ALIVE_TIME = 0.005;

let lastTime = performance.now();
let lastDetection = 0;

let controllerData = [];
let activeTWR = {};
let activeCTR = {};

let ctrCircles = [];
const CTR_RANGE_WORLD = 20000;


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
    if (!data?.position) return;

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

    const newPlaneList = Object.keys(liveData).sort();
    const currentFlight = planeList[selectedPlaneIndex];

    planeList = newPlaneList;

    if (planeList.length === 0) {
      selectedPlaneIndex = 0;
      terminalOutput.textContent = "No planes detected";
      cleanupDeadPlanes();
      return;
    }

    const index = planeList.indexOf(currentFlight);
    selectedPlaneIndex = index >= 0 ? index : 0;

    cleanupDeadPlanes();
    updateRadarStats();

  } catch (err) {
    console.error(err);
  }
}

setInterval(updateRadarData, 5000);
updateRadarData();





async function fetchControllers() {
  const response = await fetch("/api/controllers");
  return await response.json();
}





async function updateControllers() {
  try {
    controllerData = await fetchControllers();

    activeTWR = {};
    activeCTR = {};

    controllerData.forEach(ctrl => {
      if (!ctrl.holder) return;

      if (ctrl.position == "TWR") {
        activeTWR[ctrl.airport] = true;
      }

      if (ctrl.position == "CTR") {
        activeCTR[ctrl.airport] = true;
      }
    });

    updateTowerStates();
    updateCTRVisuals();

  } catch (err) {
    console.error(err);
  }
}

setInterval(updateControllers, 30000);
updateControllers();















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
  return angle < 0 ? angle + 360 : angle;
}

// ===============================
// RANGE RINGS + LINES + DIAMONDS
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
  const center = RADAR_SIZE / 2;
  const radius = RADAR_SIZE / 2 - 30;

  const cardinalMap = { 0: "N", 90: "E", 180: "S", 270: "W" };

  for (let i = 0; i < 12; i++) {
    const angleDeg = i * 30;
    const angleRad = (angleDeg - 90) * (Math.PI / 180);

    const line = document.createElement("div");
    line.className = "radar-line";
    line.style.transform = `rotate(${angleDeg}deg)`;
    radar.appendChild(line);

    const label = document.createElement("div");
    label.className = "radar-angle-label";

    if (cardinalMap[angleDeg] !== undefined) {
      label.innerHTML = `
        <span class="radar-cardinal-letter">${cardinalMap[angleDeg]}</span>
        ${angleDeg}°
      `;
    } else {
      label.textContent = `${angleDeg}°`;
    }

    const x = center + radius * Math.cos(angleRad);
    const y = center + radius * Math.sin(angleRad);

    label.style.left = `${x}px`;
    label.style.top = `${y}px`;

    radar.appendChild(label);
  }
}
createRadialLines();

const towerPositions = [
  { name: "IRFD", x: -2977, y: 21047 },
  { name: "ITKO", x: -8607, y: -32277 },
  { name: "IZOL", x: 44645, y: 3861 },
  { name: "ILAR", x: 21255, y: 32905 },
  { name: "IPPH", x: 17806, y: -19660 },
  { name: "IBTH", x: 5725, y: -4334 },
  { name: "IGRV", x: -43276, y: -2408 },
  { name: "ISAU", x: -46040, y: 27767 },
  { name: "IMLR", x: -19602, y: 14671 }
];


let towerElements = [];

function createTowerMarkers() {
  towerPositions.forEach((tower) => {

    const container = document.createElement("div");
    container.className = "tower-container";

    const marker = document.createElement("div");
    marker.className = "tower-marker";

    const label = document.createElement("div");
    label.className = "tower-label";
    label.textContent = tower.name;

    container.appendChild(marker);
    container.appendChild(label);

    const { screenX, screenY } = worldToScreen(tower.x, tower.y);

    container.style.left = `${screenX}px`;
    container.style.top = `${screenY}px`;

    radar.appendChild(container);

    towerElements.push({
      element: container,
      label: label,
      worldX: tower.x,
      worldY: tower.y
    });
  });
}


createTowerMarkers();



// ===============================
// CLEANUP
// ===============================
function cleanupDeadPlanes() {
  Object.keys(planeElements).forEach((flightName) => {
    if (!liveData[flightName]) {
      planeElements[flightName].remove();
      delete planeElements[flightName];
    }
  });
}

// ===============================
// DETECTION
// ===============================
function detectHits() {
  Object.entries(planeAngles).forEach(([flightName, obj]) => {

    const { screenX, screenY, angle, data } = obj;

    let diff = Math.abs(angle - sweepAngle);
    if (diff > 180) diff = 360 - diff;
    if (diff >= BEAM_WIDTH) return;

    let plane = planeElements[flightName];

    // =============================
    // CREATE PLANE IF NOT EXISTS
    // =============================
    if (!plane) {
      const container = document.createElement("div");
      container.className = "plane-container";

      const dot = document.createElement("div");
      dot.className = "plane";

      const label = document.createElement("div");
      label.className = "plane-label";

      container.appendChild(dot);
      container.appendChild(label);
      radar.appendChild(container);

      planeElements[flightName] = container;
      plane = container;
    }

    // =============================
    // SAFE TO USE PLANE NOW
    // =============================

    plane.style.left = `${screenX}px`;
    plane.style.top = `${screenY}px`;
    plane.style.opacity = 0.75;
    
    // Store last pinged world position
    if (data?.position) {
	    lastPingedPositions[flightName] = {
		    x: data.position.x,
		    y: data.position.y
	    };
    }


    // ---- Update Label Text With Index ----
    const label = plane.querySelector(".plane-label");
    const index = planeList.indexOf(flightName);

    if (label && index !== -1) {
      label.textContent = `${index}. ${flightName}`;
    }

    // ---- Update Dot Color ----
    const dot = plane.querySelector(".plane");

    if (dot) {
      if (data?.isEmergencyOccuring) {
        dot.style.background = "red";
        dot.style.boxShadow = "0 0 10px red";
      } else if (data?.isOnGround) {
        dot.style.background = "#00aaff";
        dot.style.boxShadow = "0 0 10px #00aaff";
      } else {
        dot.style.background = "#ffffff";
        dot.style.boxShadow = "0 0 10px #00ff00";
      }
    }

    // ---- Selected Plane Highlight ----
    if (planeList[selectedPlaneIndex] === flightName) {
      if (selectedOutline) {
        selectedOutline.remove();
      }

      selectedOutline = document.createElement("div");
      selectedOutline.className = "selected-outline";

      selectedOutline.style.left = `${screenX - 4}px`;
      selectedOutline.style.top  = `${screenY - 4}px`;

      radar.appendChild(selectedOutline);
      displaySelectedPlaneInfo();
      updateLabelScaling();
    }

  });
}


// ===============================
// HIGHLIGHT
// ===============================
let selectedOutline = null;

function updateSelectedOutline(flightName) {
  const angleData = planeAngles[flightName];
  if (!angleData) return;

  const { screenX, screenY } = angleData;

  selectedOutline = document.createElement("div");
  selectedOutline.className = "selected-outline";

  selectedOutline.style.left = `${screenX - 4}px`;
  selectedOutline.style.top  = `${screenY - 4}px`;

  radar.appendChild(selectedOutline);
}

function highlightSelectedPlane() {
  if (!planeList.length) return;

  const selectedFlight = planeList[selectedPlaneIndex];

  if (selectedOutline) {
    selectedOutline.remove();
    selectedOutline = null;
  }

  if (!planeAngles[selectedFlight]) return;

  updateSelectedOutline(selectedFlight);
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

  Object.values(planeElements).forEach((plane) => {
    let currentOpacity = parseFloat(plane.style.opacity) || 0;
    plane.style.opacity = Math.max(0, currentOpacity - PING_ALIVE_TIME);
  });

  if (now - lastDetection > 50) {
  
	lastDetection = now;
	detectHits();
	updateClutter();
    
	// =============================
	// TRACK MODE FOLLOW (PING-BASED)
	// =============================
	if (trackMode && planeList.length > 0) {
	
		const selectedFlight = planeList[selectedPlaneIndex];
		const pinged = lastPingedPositions[selectedFlight];

		if (pinged) {
			panCameraToWorld(pinged.x, pinged.y);
		}
	}

    
  }

  requestAnimationFrame(radarEngine);
}
requestAnimationFrame(radarEngine);



// ===============================
// TRANSFORM HANDLING + PANNING
// ===============================
function updateTransform() {
	radar.style.transform = `scale(${scale}) translate(${translateX}px, ${translateY}px)`;
}




function panCameraToWorld(worldX, worldY) {

	cameraTarget.x = worldX;
	cameraTarget.y = worldY;

	const { screenX, screenY } = worldToScreen(worldX, worldY);

	const radarCenter = RADAR_SIZE / 2;

	// remove multiplication by scale
	translateX = radarCenter - screenX;
	translateY = radarCenter - screenY;

	updateTransform();
}





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




// ===============================
// KNOB CONTROL SYSTEM
// ===============================

const sweepPresets = [5000, 10000, 15000, 20000, 25000];
const pingPresets = [0.005, 0.004, 0.003, 0.002, 0.001];
const zoomPresets = [1, 1.5, 2, 2.5, 3, 5,10];
const tPresets = [2, 4, 8, 16, 32, 64, 128, 180];

let sweepIndex = 2;
let pingIndex = 3;
let zoomIndex = 0;
let tIndex = 4;

const sweepKnob = document.getElementById("sweepKnob");
const pingKnob = document.getElementById("pingKnob");
const zoomKnob = document.getElementById("zoomKnob");
const tKnob = document.getElementById("tKnob");

function updateKnobVisual(knob, index, max) {
  const rotation = (index / (max - 1)) * 270 - 135;
  knob.style.transform = `rotate(${rotation}deg)`;
}

function setupKnob(knobEl, presets, indexVar, applyFn) {
  let index = indexVar;

  function update() {
    applyFn(presets[index]);
    updateKnobVisual(knobEl, index, presets.length);
  }

  // left click → forward
  knobEl.addEventListener("click", (e) => {
    e.preventDefault();
    index = (index + 1) % presets.length;
    update();
  });

  // right click → backward
  knobEl.addEventListener("contextmenu", (e) => {
    e.preventDefault(); // prevent browser menu
    index = (index - 1 + presets.length) % presets.length;
    update();
  });

  // initialize visual
  update();

  // return updated index for reference
  return () => index;
}

// SWEEP knob
let getSweepIndex = setupKnob(
  document.getElementById("sweepKnob"),
  sweepPresets,
  sweepIndex,
  (val) => {
  SWEEP_DURATION = val;
  updateRadarStats();
  }
);

// PING knob
let getPingIndex = setupKnob(
  document.getElementById("pingKnob"),
  pingPresets,
  pingIndex,
  (val) => {
	  PING_ALIVE_TIME = val;
	  updateRadarStats();
  }
);

// ZOOM knob
let getZoomIndex = setupKnob(
  document.getElementById("zoomKnob"),
  zoomPresets,
  zoomIndex,
  (val) => {
	scale = val;
	panCameraToWorld(cameraTarget.x, cameraTarget.y);
	updateLabelScaling();
	updateRadarStats();
  }
);

// TERMINAL knob
let getTerminalIndex = setupKnob(
  document.getElementById("tKnob"),
  tPresets,
  tIndex,
  (val) => {
	SPED = val;
	updateRadarStats();
  }
);


// Initialize knob visuals
updateKnobVisual(sweepKnob, sweepIndex, sweepPresets.length);
updateKnobVisual(pingKnob, pingIndex, pingPresets.length);
updateKnobVisual(zoomKnob, zoomIndex, zoomPresets.length);
updateKnobVisual(tKnob, tIndex, tPresets.length);

const btnCENTER = document.getElementById("btnRESET");
const btnIRFD = document.getElementById("btnIRFD");
const btnITKO = document.getElementById("btnITKO");
const btnIZOL = document.getElementById("btnIZOL");
const btnILAR = document.getElementById("btnILAR");
const btnIPPH = document.getElementById("btnIPPH");
const btnIBTH = document.getElementById("btnIBTH");
const btnIGRV = document.getElementById("btnIGRV");
const btnISAU = document.getElementById("btnISAU");
const btnIMLR = document.getElementById("btnIMLR");



// Buttons



const prevBtn = document.getElementById("prevPlane");
const nextBtn = document.getElementById("nextPlane");
const runwaySwitch = document.getElementById("runwaySwitch");
const trackSwitch = document.getElementById("trackSwitch");



prevBtn.addEventListener("click", () => {
  selectedPlaneIndex =
    (selectedPlaneIndex - 1 + planeList.length) % planeList.length;
	highlightSelectedPlane();
	displaySelectedPlaneInfo();
	updateRadarStats();
});

nextBtn.addEventListener("click", () => {
  selectedPlaneIndex = (selectedPlaneIndex + 1) % planeList.length;
	highlightSelectedPlane();
	displaySelectedPlaneInfo();
	updateRadarStats();
});




runwaySwitch.addEventListener("click", () => {
  runwaysVisible = !runwaysVisible;

  runwayElements.forEach((el) => {
    el.style.display = runwaysVisible ? "block" : "none";
  });

  runwaySwitch.classList.toggle("on", runwaysVisible);
});






trackSwitch.addEventListener("click", () => {
  trackMode = !trackMode;
  trackSwitch.classList.toggle("on", trackMode);
});









btnRESET.addEventListener("click", () => {
  panCameraToWorld(0, 0);
});

btnIRFD.addEventListener("click", () => {
  panCameraToWorld(-2977, 21047);
});

btnITKO.addEventListener("click", () => {
  panCameraToWorld(-8607, -32277);
});


btnIZOL.addEventListener("click", () => {
  panCameraToWorld(44645, 3861);
});


btnILAR.addEventListener("click", () => {
  panCameraToWorld(21255, 32905);
});


btnIPPH.addEventListener("click", () => {
  panCameraToWorld(17806, -19660);
});


btnIBTH.addEventListener("click", () => {
  panCameraToWorld(5725, -4334);
});


btnIGRV.addEventListener("click", () => {
  panCameraToWorld(-43276, -2408);
});


btnISAU.addEventListener("click", () => {
  panCameraToWorld(-46040, 27767);
});


btnIMLR.addEventListener("click", () => {
  panCameraToWorld(-19602, 14671);
});





// ===============================
// TERMINAL
// ===============================
function displaySelectedPlaneInfo() {
  if (!planeList.length) return;
  if (typingTimeout) clearTimeout(typingTimeout);

  const flightName = planeList[selectedPlaneIndex];
  const data = liveData[flightName];
  if (!data) return;

  const fieldsPerLine = 3;
  const allFields = [];

  // Add flight name at the very top
  const lines = [`Flight: ${flightName}`];

  // Add other fields
  for (const key in data) {
    let value = data[key];
    if (typeof value === "object" && value !== null) {
      value = Object.entries(value)
        .map(([k,v]) => `${k}:${v}`)
        .join(", ");
    }
    allFields.push(`${key}:${value}`);
  }

  // group fields per line
  for (let i = 0; i < allFields.length; i += fieldsPerLine) {
    lines.push(allFields.slice(i, i + fieldsPerLine).join(" | "));
  }

  // type it into the terminal
  typeTerminal(lines.join("\n"));
}



function typeTerminal(text) {
  terminalOutput.textContent = "";
  let i = 0;

  function step() {
    if (i < text.length) {
      terminalOutput.textContent += text[i];
      i++;
      typingTimeout = setTimeout(step, SPED);
    }
  }
  step();
}

// ===============================
// RADAR STATS
// ===============================
function updateRadarStats() {
  if (!radarStats) return;

  radarStats.innerHTML = `
    SWEEP:    ${(SWEEP_DURATION / 1000).toFixed(1)}s<br>
    PING:     ${(PING_ALIVE_TIME*1000).toFixed(1)}<br>
    ZOOM:     ${scale.toFixed(1)}x<br>
    FLIGHT:   ${selectedPlaneIndex}/${planeList.length-1}<br>
    TERMINAL: ${SPED}ms
  `;
}

// ===============================
// LABEL SCALING
// ===============================

function updateLabelScaling() {
  const inverse = 1.5 / scale;

  // Plane labels
  Object.values(planeElements).forEach((container) => {
    const label = container.querySelector(".plane-label");
    if (label) {
      label.style.transform = `scale(${inverse})`;
      label.style.transformOrigin = "left top";
    }
  });

  // Tower labels
  towerElements.forEach((tower) => {
    if (tower.label) {
      tower.label.style.transform = `translateX(-50%) scale(${inverse})`;
      tower.label.style.transformOrigin = "center top";
    }
  });
}

// === === ===
// REAL
// === === ===



function updateTowerStates() {
  towerElements.forEach(tower => {

    const marker = tower.element.querySelector(".tower-marker");

    if (!marker) return;

    if (activeTWR[tower.element.querySelector(".tower-label").textContent]) {
      marker.style.borderColor = "white";
    } else {
      marker.style.borderColor = "black";
    }

  });
}




const TWR_TO_CTR = {
  IRFD: "IRCC",
  ITKO: "IOCC",
  IZOL: "IZCC",
  ILAR: "ICCC",
  IPPH: "IPCC",
  IBTH: "IBCC",
  IGRV: "IGCC",
  ISAU: "ISCC"
};


function updateCTRVisuals() {

  // Remove old circles
  ctrCircles.forEach(c => c.remove());
  ctrCircles = [];

towerElements.forEach(tower => {
  const twrCode = tower.label.textContent;
  const ctrCode = TWR_TO_CTR[twrCode];

  if (!ctrCode || !activeCTR[ctrCode]) return;

    const circle = document.createElement("div");
    circle.className = "ctr-circle";

    const centerScreen = worldToScreen(tower.worldX, tower.worldY);

    const edgeScreen = worldToScreen(
      tower.worldX + CTR_RANGE_WORLD,
      tower.worldY
    );

    const radiusPx = Math.abs(edgeScreen.screenX - centerScreen.screenX);
    const diameter = radiusPx * 2;

    circle.style.width = `${diameter}px`;
    circle.style.height = `${diameter}px`;
    circle.style.left = `${centerScreen.screenX - radiusPx}px`;
    circle.style.top = `${centerScreen.screenY - radiusPx}px`;

    radar.appendChild(circle);
    ctrCircles.push(circle);
  });
}



// ===============================
// RUNWAYS (start ↔ end)
// ===============================

const runwayData = [
  {
    name: "IRFD",
    start: { x: -3838, y: 20851 }, // 07R
    end:   { x: -2340, y: 20215 }  // 25L
  },  
  {
    name: "IKTO",
    start: { x: -9225, y: -33530 }, // 13
    end:   { x: -7612, y: -32270 }  // 32
  },
  {
    name: "IKTO",
    start: { x: -6992, y: -30698 }, // 02
    end:   { x: -6295, y: -32613 }  // 20
  },
	  {
    name: "IPPH",
    start: { x: 18627, y: -19642 }, // 15
    end:   { x: 17665, y: -21379 }  // 33
  },
  {
    name: "IPPH",
    start: { x: 17391, y: -20745 }, // 11
    end:   { x: 19617, y: -19889 }  // 29
  },
  {
    name: "IMLR",
    start: { x: -20186, y: 15180 }, // 07
    end:   { x: -18705, y: 14519 }  // 25
  },
  {
    name: "IBTH",
    start: { x: 5349, y: -4485 },   // 09
    end:   { x: 6209, y: -4484 }    // 27
  },
  {
    name: "ILAR",
    start: { x: 20510, y: 32789 },  // 06
    end:   { x: 22143, y: 31994 }   // 24
  },
  {
    name: "IZOL",
    start: { x: 43494, y: 2929 },   // 10
    end:   { x: 45773, y: 3582 }    // 28
  },
  {
    name: "IGRV",
    start: { x: -43729, y: -2569 }, // 06
    end:   { x: -42602, y: -3169 }  // 24
  },
  {
    name: "ISAU",
    start: { x: -46785, y: 27578 }, // 08
    end:   { x: -45418, y: 27483 }  // 26
  }
];

let runwayElements = [];
let runwaysVisible = true;




function createRunways() {
  const EXTENSION_WORLD = 6000; // how far it extends beyond runway (world units)

  runwayData.forEach((rwy) => {

    const start = rwy.start;
    const end   = rwy.end;

    // Direction vector in WORLD space
    const dx = end.x - start.x;
    const dy = end.y - start.y;

    const lengthWorld = Math.sqrt(dx * dx + dy * dy);

    const dirX = dx / lengthWorld;
    const dirY = dy / lengthWorld;

    // Extend both ends in world space
    const extStart = {
      x: start.x - dirX * EXTENSION_WORLD,
      y: start.y - dirY * EXTENSION_WORLD
    };

    const extEnd = {
      x: end.x + dirX * EXTENSION_WORLD,
      y: end.y + dirY * EXTENSION_WORLD
    };

    // Convert to screen
    const s1 = worldToScreen(start.x, start.y);
    const s2 = worldToScreen(end.x, end.y);

    const e1 = worldToScreen(extStart.x, extStart.y);
    const e2 = worldToScreen(extEnd.x, extEnd.y);

    // ---- Create extended dashed line ----
    const dashedDx = e2.screenX - e1.screenX;
    const dashedDy = e2.screenY - e1.screenY;
    const dashedLength = Math.sqrt(dashedDx*dashedDx + dashedDy*dashedDy);
    const dashedAngle = Math.atan2(dashedDy, dashedDx) * (180 / Math.PI);

    const dashed = document.createElement("div");
    dashed.className = "runway-extended";
    dashed.style.width = `${dashedLength}px`;
    dashed.style.left = `${e1.screenX}px`;
    dashed.style.top = `${e1.screenY}px`;
    dashed.style.transformOrigin = "0 50%";
    dashed.style.transform = `rotate(${dashedAngle}deg)`;

    radar.appendChild(dashed);

    // ---- Create solid runway ----
    const solidDx = s2.screenX - s1.screenX;
    const solidDy = s2.screenY - s1.screenY;
    const solidLength = Math.sqrt(solidDx*solidDx + solidDy*solidDy);
    const solidAngle = Math.atan2(solidDy, solidDx) * (180 / Math.PI);

    const solid = document.createElement("div");
    solid.className = "runway-solid";
    solid.style.width = `${solidLength}px`;
    solid.style.left = `${s1.screenX}px`;
    solid.style.top = `${s1.screenY}px`;
    solid.style.transformOrigin = "0 50%";
    solid.style.transform = `rotate(${solidAngle}deg)`;

    radar.appendChild(solid);

    runwayElements.push(dashed, solid);
  });
}

createRunways();




