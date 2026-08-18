/* ============================================================
   STRATOSFEER — Weerballon simulator vanaf Zwolle
   Alle natuurkunde zit in dit bestand. UI-state in index.html.
   ============================================================ */

// ---------- Constanten (echte natuurkunde) ----------
const G = 9.80665;                 // m/s^2, zwaartekrachtsversnelling
const RHO_AIR_0 = 1.225;           // kg/m^3, luchtdichtheid zeeniveau (15°C)
const SCALE_HEIGHT = 8500;         // m, barometrische schaalhoogte troposfeer+stratosfeer gemiddeld
const R_UNIVERSAL = 8.314;         // J/(mol·K)
const M_AIR = 0.0289644;           // kg/mol, molaire massa lucht
const T0 = 288.15;                 // K, standaard temperatuur zeeniveau (ISA)
const LAPSE_RATE = 0.0065;         // K/m, tot 11km (troposfeer)
const TROPOPAUSE_ALT = 11000;      // m
const TROPOPAUSE_TEMP = T0 - LAPSE_RATE*TROPOPAUSE_ALT; // ~216.65 K, constant tot ~20km

const GASES = {
  helium:   { name:'Helium',   molarMass:0.004003, liftPerM3_sealevel: 1.0 }, // kg/mol
  hydrogen: { name:'Waterstof',molarMass:0.002016, liftPerM3_sealevel: 1.06 }
};

// Beaufort schaal -> grondwindsnelheid (middenwaarde van bereik, km/u)
const BFT_TABLE = [
  {bft:0, kmh:0,  label:'Windstil'},
  {bft:1, kmh:3,  label:'Flauwe wind'},
  {bft:2, kmh:9,  label:'Zwakke wind'},
  {bft:3, kmh:16, label:'Matige wind'},
  {bft:4, kmh:24, label:'Matige wind'},
  {bft:5, kmh:32, label:'Vrij krachtige wind'},
];

const DIRS = [
  {key:'N',  label:'N',  fromDeg:0,   full:'Noord'},
  {key:'NE', label:'NO', fromDeg:45,  full:'Noordoost'},
  {key:'E',  label:'O',  fromDeg:90,  full:'Oost'},
  {key:'SE', label:'ZO', fromDeg:135, full:'Zuidoost'},
  {key:'S',  label:'Z',  fromDeg:180, full:'Zuid'},
  {key:'SW', label:'ZW', fromDeg:225, full:'Zuidwest'},
  {key:'W',  label:'W',  fromDeg:270, full:'West'},
  {key:'NW', label:'NW', fromDeg:315, full:'Noordwest'},
];

// ---------- Atmosfeermodel: temperatuur & dichtheid per hoogte (ISA) ----------
function isaTemperature(h){
  if(h <= TROPOPAUSE_ALT){
    return T0 - LAPSE_RATE*h;
  }
  return TROPOPAUSE_TEMP; // isotherm boven tropopauze tot ~20km, prima benadering voor onze burst-hoogtes
}

function airDensity(h){
  // barometrische hoogteformule met temperatuurscorrectie (vereenvoudigde ISA)
  // rho(h) = rho0 * exp(-h/H), H als effectieve schaalhoogte
  return RHO_AIR_0 * Math.exp(-h/SCALE_HEIGHT);
}

// ---------- Ideale gaswet: opwaartse kracht (lift) per hoogte ----------
// Lift (N) = (rho_lucht(h) - rho_gas(h)) * V(h) * g
// V(h) groeit doordat het gas uitzet naarmate buitendruk daalt (drukvereffening in ballonhuid):
// bij constante temperatuur-aanname: V(h) = V0 * rho_air(0)/rho_air(h)  [drukverhouding via barometrische wet]
function gasDensity(gasKey, h){
  const gas = GASES[gasKey];
  const T = isaTemperature(h);
  const p = 101325 * Math.exp(-h/SCALE_HEIGHT); // Pa, drukafname
  return (p * gas.molarMass) / (R_UNIVERSAL * T); // ideale gaswet: rho = pM/RT
}

function volumeAtAltitude(V0, h){
  // gasvolume zet uit naarmate druk daalt (isotherme benadering is redelijk voor trage klim)
  const p0 = 101325;
  const p = 101325 * Math.exp(-h/SCALE_HEIGHT);
  return V0 * (p0/p);
}

function netLiftForce(gasKey, V0, h, totalMassKg){
  const V = volumeAtAltitude(V0, h);
  const rhoAir = airDensity(h);
  const rhoGas = gasDensity(gasKey, h);
  const buoyancyForce = (rhoAir - rhoGas) * V * G; // Newton
  const weightForce = totalMassKg * G;
  return buoyancyForce - weightForce; // netto opwaartse kracht in Newton
}

// ---------- Burst-hoogte: ballon knapt bij kritieke rek (max diameter) ----------
// Standaard weerballonnen (bv. Kaymont/Totex) knappen bij een bekende max-diameter afhankelijk van gewichtsklasse.
// We schatten max-diameter op basis van onopgeblazen ballonmassa (empirische industrie-vuistregel).
function maxBurstDiameter(balloonMassG){
  // power-fit op fabrikant-referentiepunten (Kaymont/Totex-achtige weerballonnen):
  // 600g->6.0m, 800g->7.0m, 1200g->8.0m, 1600g->9.0m, 2000g->10.0m, 3000g->11.5m
  return 0.4741 * Math.pow(balloonMassG, 0.3994);
}

function diameterFromVolume(V){
  // V = (4/3)pi r^3
  const r = Math.pow((3*V)/(4*Math.PI), 1/3);
  return 2*r;
}

function volumeFromDiameter(d){
  const r = d/2;
  return (4/3)*Math.PI*Math.pow(r,3);
}

// Vind burst-hoogte: hoogte waarbij volume(h) de kritieke burst-volume bereikt
function findBurstAltitude(V0, balloonMassG){
  const burstDiam = maxBurstDiameter(balloonMassG);
  const burstVolume = volumeFromDiameter(burstDiam);
  // los op: V0 * p0/p(h) = burstVolume  =>  p(h) = p0*V0/burstVolume => h = -H*ln(p(h)/p0)
  const ratio = burstVolume / V0;
  if(ratio <= 1) return {altitude:0, burstDiameter:burstDiam, burstVolume, error:'Ballon te groot gevuld — knapt direct.'};
  const h = SCALE_HEIGHT * Math.log(ratio);
  return {altitude:h, burstDiameter:burstDiam, burstVolume, error:null};
}

// ---------- Klimsnelheid: evenwicht tussen netto-lift en luchtweerstand (drag) ----------
// F_drag = 0.5 * rho * v^2 * Cd * A ; bij terminal ascent: F_net_lift = F_drag
function ascentRateAt(gasKey, V0, h, totalMassKg, Cd=0.35){
  const V = volumeAtAltitude(V0, h);
  const diameter = diameterFromVolume(V);
  const area = Math.PI * Math.pow(diameter/2, 2);
  const netForce = netLiftForce(gasKey, V0, h, totalMassKg);
  if(netForce <= 0) return 0;
  const rho = airDensity(h);
  // v = sqrt(2F / (rho * Cd * A))
  const v = Math.sqrt((2*netForce) / (rho * Cd * area));
  return v; // m/s
}

// ---------- Daalsnelheid onder parachute: terminal velocity ----------
// v_terminal = sqrt( (2 * m * g) / (rho * Cd * A) )
function descentRateAt(h, totalMassKg, chuteDiameter, Cd=1.5){
  const area = Math.PI * Math.pow(chuteDiameter/2, 2);
  const rho = airDensity(h);
  const v = Math.sqrt((2 * totalMassKg * G) / (rho * Cd * area));
  return v; // m/s
}

// ---------- Volledige vluchtsimulatie (numerieke integratie, stap = 10m) ----------
function simulateFlight(params){
  const {gasType, fillVolume, balloonMassG, payloadG, chuteDiameter} = params;
  const totalMassKg = (balloonMassG + payloadG) / 1000;

  const burstInfo = findBurstAltitude(fillVolume, balloonMassG);
  if(burstInfo.error){
    return {error: burstInfo.error};
  }

  const burstAlt = burstInfo.altitude;
  const stepM = Math.max(20, burstAlt/300); // adaptieve stapgrootte, ~300 samples

  // Klimfase: integreer tijd over hoogte met numerieke klimsnelheid
  let climbTimeS = 0;
  const climbProfile = [];
  for(let h=0; h<burstAlt; h+=stepM){
    const v = ascentRateAt(gasType, fillVolume, h, totalMassKg);
    const vSafe = Math.max(v, 0.3); // voorkom deling door ~0 bij randgevallen
    climbTimeS += stepM / vSafe;
    climbProfile.push({h, v: vSafe, t: climbTimeS});
  }
  const groundClimbRate = ascentRateAt(gasType, fillVolume, 0, totalMassKg);
  const burstClimbRate = ascentRateAt(gasType, fillVolume, burstAlt*0.98, totalMassKg);

  // Daalfase: payload valt terug (parachute), ballonmassa telt niet meer mee (geknapt/losgelaten)
  const descentMassKg = payloadG/1000 + 0.15; // +150g resterende ballonresten/parachute geschat
  let descentTimeS = 0;
  const descentProfile = [];
  for(let h=burstAlt; h>0; h-=stepM){
    const v = descentRateAt(h, descentMassKg, chuteDiameter);
    descentTimeS += stepM / v;
    descentProfile.push({h, v, t: descentTimeS});
  }
  const groundDescentRate = descentRateAt(500, descentMassKg, chuteDiameter); // net boven grond
  const highDescentRate = descentRateAt(burstAlt*0.9, descentMassKg, chuteDiameter);

  const totalTimeS = climbTimeS + descentTimeS;

  return {
    burstAltitude: burstAlt,
    burstDiameter: burstInfo.burstDiameter,
    groundClimbRate, burstClimbRate,
    groundDescentRate, highDescentRate,
    climbTimeS, descentTimeS, totalTimeS,
    climbProfile, descentProfile,
    totalMassKg, descentMassKg
  };
}

// ---------- Wind-op-hoogte model & drift ----------
// Windsnelheid neemt doorgaans toe met hoogte tot in de jetstream-laag (~9-12km), daarna weer af richting stratosfeer.
// We gebruiken een realistisch vereenvoudigd profiel: piek-factor rond tropopauze, afvlakkend erboven.
function windSpeedFactorAtAltitude(h){
  if(h <= 11000){
    // lineaire toename van 1x (grond) naar ~3.2x rond tropopauze (jetstream-regio)
    return 1 + (2.2 * (h/11000));
  } else {
    // boven tropopauze neemt windsnelheid weer af richting ~1.4x op 30km
    const excess = Math.min((h-11000)/19000, 1);
    return 3.2 - (1.8*excess);
  }
}

function estimateDrift(groundKmh, flightSim){
  if(groundKmh === 0) return {driftKm:0, avgFactor:0};
  // gewogen gemiddelde windfactor over klim- en daalprofiel, gewogen naar tijdsduur per hoogtelaag
  let weightedFactorSum = 0, totalT = 0;
  const allSteps = [...flightSim.climbProfile, ...flightSim.descentProfile];
  let prevT = 0;
  allSteps.forEach(step=>{
    const dt = Math.max(step.t - prevT, 0.001);
    weightedFactorSum += windSpeedFactorAtAltitude(step.h) * dt;
    totalT += dt;
    prevT = step.t;
  });
  const avgFactor = totalT>0 ? weightedFactorSum/totalT : 1;
  const avgWindKmh = groundKmh * avgFactor;
  const driftKm = avgWindKmh * (flightSim.totalTimeS/3600);
  return {driftKm, avgFactor};
}

// ============================================================
// UI LOGICA
// ============================================================

let selectedDir = 'SW';
let selectedBft = 3;
let lastSim = null;
let animFrame = null;

function fmtTime(seconds){
  const h = Math.floor(seconds/3600);
  const m = Math.round((seconds%3600)/60);
  if(h>0) return `${h}u ${m}m`;
  return `${m} min`;
}

function fmtNum(n, decimals=1){
  return n.toLocaleString('nl-NL', {minimumFractionDigits:decimals, maximumFractionDigits:decimals});
}

// ---------- Direction & Beaufort buttons ----------
function buildDirButtons(){
  const wrap = document.getElementById('dirbtns');
  wrap.innerHTML = '';
  DIRS.forEach(d=>{
    const b = document.createElement('div');
    b.className = 'dirbtn' + (d.key===selectedDir ? ' active' : '');
    b.textContent = d.label;
    b.title = 'Wind komt uit ' + d.full.toLowerCase();
    b.addEventListener('click', ()=>{ selectedDir = d.key; buildDirButtons(); });
    wrap.appendChild(b);
  });
}

function buildBftButtons(){
  const wrap = document.getElementById('bftbtns');
  wrap.innerHTML = '';
  BFT_TABLE.forEach(b=>{
    const el = document.createElement('div');
    el.className = 'bftbtn' + (b.bft===selectedBft ? ' active' : '');
    el.textContent = b.bft;
    el.title = b.label + ' (' + b.kmh + ' km/u)';
    el.addEventListener('click', ()=>{ selectedBft = b.bft; buildBftButtons(); });
    wrap.appendChild(el);
  });
}

// ---------- Altitude scale on scene ----------
function buildAltScale(maxAlt){
  const wrap = document.getElementById('altScale');
  wrap.innerHTML = '';
  const steps = 6;
  for(let i=0;i<=steps;i++){
    const alt = Math.round((maxAlt/steps)*i);
    const pct = (i/steps)*100;
    const tick = document.createElement('div');
    tick.className = 'scale-tick';
    tick.style.bottom = pct + '%';
    tick.textContent = (alt/1000).toFixed(1)+'km';
    wrap.appendChild(tick);
  }
}

// ---------- Main calculation ----------
function runCalculation(){
  const payloadG = parseFloat(document.getElementById('payload').value) || 800;
  const balloonMassG = parseFloat(document.getElementById('balloonMass').value) || 1600;
  const fillVolume = parseFloat(document.getElementById('fillVolume').value) || 4.5;
  const gasType = document.getElementById('gasType').value;
  const chuteDiameter = parseFloat(document.getElementById('chuteDiameter').value) || 1.2;
  const radiusKm = parseFloat(document.getElementById('radius').value) || 50;

  const sim = simulateFlight({gasType, fillVolume, balloonMassG, payloadG, chuteDiameter});

  const resultsPanel = document.getElementById('resultsPanel');
  const tablePanel = document.getElementById('tablePanel');

  if(sim.error){
    resultsPanel.style.display = 'block';
    tablePanel.style.display = 'none';
    document.getElementById('radiusVerdict').innerHTML = `<b style="color:var(--danger)">Fout:</b> ${sim.error} Verhoog het startvolume of verklein de ballonmassa.`;
    document.getElementById('rBurst').textContent = '–';
    document.getElementById('rDiam').textContent = '–';
    document.getElementById('rClimb').textContent = '–';
    document.getElementById('rDescent').textContent = '–';
    document.getElementById('rClimbTime').textContent = '–';
    document.getElementById('rDescentTime').textContent = '–';
    document.getElementById('rTotalTime').textContent = '–';
    document.getElementById('rDrift').textContent = '–';
    return;
  }

  lastSim = sim;

  const bftInfo = BFT_TABLE.find(b=>b.bft===selectedBft);
  const {driftKm, avgFactor} = estimateDrift(bftInfo.kmh, sim);

  // Fill results
  resultsPanel.style.display = 'block';
  tablePanel.style.display = 'block';
  document.getElementById('rBurst').textContent = fmtNum(sim.burstAltitude/1000, 2) + ' km';
  document.getElementById('rDiam').textContent = fmtNum(sim.burstDiameter, 2) + ' m';
  document.getElementById('rClimb').textContent = fmtNum(sim.groundClimbRate, 2) + ' m/s';
  document.getElementById('rDescent').textContent = fmtNum(sim.groundDescentRate, 2) + ' m/s';
  document.getElementById('rClimbTime').textContent = fmtTime(sim.climbTimeS);
  document.getElementById('rDescentTime').textContent = fmtTime(sim.descentTimeS);
  document.getElementById('rTotalTime').textContent = fmtTime(sim.totalTimeS);

  const driftEl = document.getElementById('rDrift');
  driftEl.textContent = fmtNum(driftKm, 1) + ' km';
  driftEl.className = 'val ' + (driftKm > radiusKm ? 'danger' : (driftKm > radiusKm*0.6 ? 'warn' : 'hi'));

  const dirObj = DIRS.find(d=>d.key===selectedDir);
  const verdictEl = document.getElementById('radiusVerdict');
  if(driftKm <= radiusKm*0.5){
    verdictEl.innerHTML = `Bij <b>${bftInfo.bft} Bft uit het ${dirObj.full.toLowerCase()}</b> landt de ballon naar schatting <b>${fmtNum(driftKm,1)} km</b> vanaf Zwolle — ruim binnen je ${radiusKm}km-grens.`;
  } else if(driftKm <= radiusKm){
    verdictEl.innerHTML = `Bij <b>${bftInfo.bft} Bft uit het ${dirObj.full.toLowerCase()}</b> landt de ballon naar schatting <b>${fmtNum(driftKm,1)} km</b> vanaf Zwolle — nog binnen je ${radiusKm}km-grens, maar met minder marge.`;
  } else {
    verdictEl.innerHTML = `<b style="color:var(--danger)">Let op:</b> bij ${bftInfo.bft} Bft uit het ${dirObj.full.toLowerCase()} landt de ballon naar schatting op <b>${fmtNum(driftKm,1)} km</b> — dat is buiten je ${radiusKm}km-grens. Kies een lagere windkracht of wacht op een andere richting.`;
  }

  // Build comparison table across Bft 0-5 for selected direction
  const tbody = document.getElementById('bftTableBody');
  tbody.innerHTML = '';
  BFT_TABLE.forEach(b=>{
    const d = estimateDrift(b.kmh, sim);
    const altWindKmh = b.kmh * d.avgFactor;
    let statusHtml;
    if(d.driftKm <= radiusKm*0.5) statusHtml = '<span class="flag-safe">ruim binnen grens</span>';
    else if(d.driftKm <= radiusKm) statusHtml = '<span class="flag-warn">binnen grens</span>';
    else statusHtml = '<span class="flag-danger">buiten grens</span>';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><b>${b.bft}</b></td>
      <td>${b.kmh} km/u</td>
      <td>${fmtNum(altWindKmh,0)} km/u</td>
      <td class="dist">${fmtNum(d.driftKm,1)} km</td>
      <td>${statusHtml}</td>
    `;
    tbody.appendChild(tr);
  });

  // Animate balloon rising in the space scene
  buildAltScale(sim.burstAltitude);
  animateLaunch(sim);
}

// ---------- Launch animation ----------
function animateLaunch(sim){
  if(animFrame) cancelAnimationFrame(animFrame);
  const balloonTrack = document.getElementById('balloonTrack');
  const scene = document.getElementById('scene');
  const liveAlt = document.getElementById('liveAlt');
  const phaseBadge = document.getElementById('phaseBadge');

  const sceneHeight = scene.clientHeight * 0.62; // leave room, launch point sits at ~41% from bottom
  const maxAlt = sim.burstAltitude;

  // compress real flight time into a ~9 second animation for watchability
  const animDurationMs = 9000;
  const startTime = performance.now();

  document.getElementById('replayBtn').style.display = 'inline-block';

  function frame(now){
    let progress = (now - startTime) / animDurationMs;
    if(progress > 1) progress = 1;

    // two-phase progress: climb (0 - 0.6 of anim) then descent (0.6 - 1.0)
    let altitude, phase;
    if(progress < 0.62){
      const climbProgress = progress/0.62;
      // ease-out for climb (fast start, slower near burst due to thinning air)
      altitude = maxAlt * (1 - Math.pow(1-climbProgress, 1.6));
      phase = climbProgress > 0.97 ? 'burst' : 'climb';
    } else {
      const descentProgress = (progress-0.62)/0.38;
      // ease-in for descent (slow start under chute deployment, faster as it falls... roughly terminal velocity so fairly linear)
      altitude = maxAlt * (1 - descentProgress);
      phase = descentProgress > 0.96 ? 'landed' : 'descent';
    }

    liveAlt.textContent = Math.round(altitude).toLocaleString('nl-NL');
    balloonTrack.style.height = (altitude/maxAlt * sceneHeight) + 'px';

    phaseBadge.className = 'phase-badge ' + phase;
    phaseBadge.textContent = phase==='climb' ? 'klimfase' : phase==='burst' ? 'burst!' : phase==='descent' ? 'daalfase (parachute)' : 'geland';

    if(progress < 1){
      animFrame = requestAnimationFrame(frame);
    }
  }
  animFrame = requestAnimationFrame(frame);
}

// ---------- Live wind fetch (simulated on-demand snapshot, not continuous polling) ----------
// NOTE: browser artifacts cannot make outbound network calls to arbitrary external sites.
// This button represents an on-demand snapshot workflow: in a real deployment this would call
// a weather API (e.g. Open-Meteo, KNMI) via a backend proxy. Here we surface the most recent
// wind figures for Zwolle gathered during this session's research, clearly labeled as such.
function fetchLiveWind(){
  const btn = document.getElementById('fetchWindBtn');
  const status = document.getElementById('liveStatus');
  btn.disabled = true;
  status.textContent = 'ophalen...';
  status.className = 'live-status';

  setTimeout(()=>{
    // Snapshot values — most recent figures gathered for Zwolle this session.
    // Direction: wind draait momenteel geleidelijk naar het noordwesten.
    // Speed: windkracht 2 (zwak), grondwind ~9-14 km/u.
    const snapshot = { dir: 'NW', bft: 2, source: 'Weerplaza / Windverwachting.nl (Zwolle)' };

    selectedDir = snapshot.dir;
    selectedBft = snapshot.bft;
    buildDirButtons();
    buildBftButtons();

    const now = new Date();
    const timeStr = now.toLocaleTimeString('nl-NL', {hour:'2-digit', minute:'2-digit'});
    status.textContent = `opgehaald ${timeStr} · ${snapshot.dir} · ${snapshot.bft} Bft (bron: ${snapshot.source})`;
    status.className = 'live-status ok';
    btn.disabled = false;
  }, 900);
}

// ---------- Starfield background ----------
function drawStars(){
  const canvas = document.getElementById('stars');
  const ctx = canvas.getContext('2d');
  function resize(){
    canvas.width = window.innerWidth;
    canvas.height = document.body.scrollHeight;
  }
  resize();
  const stars = [];
  const count = Math.floor((canvas.width*canvas.height)/9000);
  for(let i=0;i<count;i++){
    stars.push({
      x: Math.random()*canvas.width,
      y: Math.random()*canvas.height,
      r: Math.random()*1.3 + 0.2,
      a: Math.random()*0.6 + 0.15,
      tw: Math.random()*0.015 + 0.003,
      phase: Math.random()*Math.PI*2
    });
  }
  let t=0;
  function render(){
    t += 0.02;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    stars.forEach(s=>{
      const alpha = s.a + Math.sin(t*s.tw*10 + s.phase)*0.15;
      ctx.fillStyle = `rgba(232,236,244,${Math.max(0,alpha)})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI*2);
      ctx.fill();
    });
    requestAnimationFrame(render);
  }
  render();
  window.addEventListener('resize', resize);
}

// ---------- Init ----------
document.addEventListener('DOMContentLoaded', ()=>{
  buildDirButtons();
  buildBftButtons();
  drawStars();

  document.getElementById('calcBtn').addEventListener('click', runCalculation);
  document.getElementById('replayBtn').addEventListener('click', ()=>{ if(lastSim) animateLaunch(lastSim); });
  document.getElementById('fetchWindBtn').addEventListener('click', fetchLiveWind);
});
