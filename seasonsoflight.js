/* ===== basic settings and definitions ===== */

// data file
const data = "utqiagvik_2024.csv";
// tiles per row in the calendar grid
const number_cols = 28;
// gap between tiles
const gutter = 2;
// single-letter weekday letters to show on hover
const week_letters = ["s","m","t","w","t","f","s"];

/* ===== canvas and layout hooks ===== */

// select the id "viz" from html for the svg where the viz will be drawn
const svg = d3.select("#viz");
// select class "tooltip" from html for the tooltip on each tile
const tooltip = d3.select(".tooltip");
/* define the same size set in the html viewBox (0 0 980 620) so the layout uses the same internal coordinate system */
const width = 980;
const height = 560;

// margins around the grid
const margin = { top: 64, right:140, bottom: 60, left: 0 };

// inner width/height for the grid itself (usable width and height are computed by subtracting margins from total width and height)
const innerW = width  - margin.left - margin.right;
const innerH = height - margin.top  - margin.bottom;

// create parent "grid" where all the tiles will be drawn
// shift it by defined margins using translate(x,y)
// this moves the group's local origin (0,0) to (margin.left, margin.top) in the svg
// so all the tile positions can start at that new local inside the grid area instead of at the svg's edge
const grid = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

/* ===== accessibility: title + description ===== */
svg.attr("role", "img");
svg.append("title").attr("id", "viz-title")
   .text("Seasons of Light in Utqiaġvik, Alaska (2024)");
svg.append("desc").attr("id", "viz-desc")
   .text("A calendar grid where each tile is a day colored by daylight hours. Polar night, Midnight Sun and the in-between are represented.");
svg.attr("aria-labelledby", "viz-title viz-desc");

/* ===== color palette for the three daylight states ===== */
// dark color for 0h (polar night), light color for 24h (midnight sun), and two endpoints for in-between gradient
const polar_flat = "#243341";
const mid_flat   = "#e0ddafff";
const between0   = "#4d6f85";
const between1   = "#cfd9dfff";

//  function that returns label for each rounded daylight category to show in tooltips
function seasonLabel(rounded_hours) {
  if (rounded_hours === 24) return "midnight sun";
  if (rounded_hours === 0)  return "polar night";
  return "in-between";
}

// function that returns a color for each daylight value to fill the tile
// it uses the argument daylightRounded to detect the extremes exactly (0 → "polar night", 24 → "midnight sun") 
// and daylightRaw to compute a smooth gradient color day-to-day
// if rounded hours are exactly 0 or 24, use the flat colors
// otherwise, it maps hours (from 1 to 23) into a number from 0 to 1

function colorFor(daylightRounded, daylightRaw) {
  if (daylightRounded === 0)  return polar_flat;
  if (daylightRounded === 24) return mid_flat;
  const t = Math.max(0, Math.min(1, (daylightRaw - 1) / 22)); // 1..23 → 0..1
  /* blend between the two in-between colors; hcl gives a smooth-looking gradient */
  return d3.interpolateHcl(between0, between1)(t);
}

// function that returns a text color for each tile color, in order to have good contrast
// first, the tile color is converted to lab, which has a lightness channel (l)
// based on l, the text will be dark or light
function textColor(fill) {
  const L = d3.lab(d3.color(fill)).l;
  return L > 65 ? "#2a3136" : "#f6f7f5";
}

// function that builds the legend below the viz
// the legend has three items: polar night swatch, midnight sun swatch, and in-between ramp
// each item has a label next to it
function buildLegend(){
  const legend = d3.select(".legend");
  legend.append("div").attr("class","legend-item")
    .html(`<span class="swatch" style="background:${polar_flat}"></span><span>polar night</span>`);
  legend.append("div").attr("class","legend-item")
    .html(`<span class="swatch" style="background:${mid_flat}"></span><span>midnight sun</span>`);
  legend.append("div").attr("class","legend-item")
    .html(`<span class="ramp"></span><span>in-between</span>`);
}
buildLegend();

/* ===== load csv and parse data ===== */
d3.csv(data).then(rows => {
  // parse "YYYY-MM-DD" format by splitting it and converting a string like "2024-06-04" into a js Date
  // .split("-") turns "2024-06-04" into ["2024","06","04"]
  // .map(Number) converts those three strings to numbers → [2024, 6, 4]
  // [y, m, d] = ... assigns y=2024, m=6, d=4
  // Date(y, mIndex, d) expects a 0-based month (January = 0, June = 5), so the month is set to m-1
  function toDate(dateString) {
    const [y, m, d] = dateString.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  // normalize raw csv rows into a tidy array the viz can use with the exact numeric/date fields needed
  const days = rows.map(raw => {
    // coerce the seconds string to a number using Number(...) and convert to hours
    const daylightH = Number(raw["daylight_duration (s)"]) / 3600;

    return {
      dateOnly: toDate(raw.time),
      daylight: daylightH,
      daylightRounded: Math.round(daylightH),
    };

    // sort the array by date so the grid lays out in calendar order (important if the csv is not sorted)
  }).sort((a, b) => d3.ascending(a.dateOnly, b.dateOnly));

/* ===== layout derived from data length ===== */

// count day tiles
const n = days.length;

// compute rows needed to place “number_cols” tiles per row
// use Math.ceil so any leftover days still create a final partial row
const rowsCount = Math.ceil(n / number_cols);

// compute the size of each tile so the grid fits exactly inside innerW horizontally:
//  - total horizontal spaces between tiles = (number_cols - 1) * gutter
//  - pixels left for tiles = innerW - total_gutters
//  - tile width = that / number_cols
const cellW = Math.floor((innerW - (number_cols - 1) * gutter) / number_cols);
// same idea vertically
const cellH = Math.floor((innerH - (rowsCount - 1) * gutter) / rowsCount);

/* ===== one "g" per day positioned in the grid ===== */

// bind "days" array to any existing <g class="day"> nodes
// this creates exactly one <g class="day"> per item
const cells = grid.selectAll("g.day")
  .data(days)
  .enter()
  .append("g")
  .attr("class", "day")  
// compute where each day tile should be in the grid based on its index i
// - col cycles 0 to (number_cols-1) using modulo (wraps to next row after the last column)
// - row is integer division (how many full rows have been filled so far)
// - each step moves by (tile size + gutter) so tiles never touch each other
.attr("transform", (_, i) => {
  const col = i % number_cols;
  const row = Math.floor(i / number_cols);
  const x = col * (cellW + gutter);
  const y = row * (cellH + gutter);
  return `translate(${x}, ${y})`; // move this "g" so its children draw at (x,y)
});

/* ===== tiles ===== */

// append a rectangle for each day tile, rounded corners, sized to cellW x cellH
// fill color is computed by colorFor() based on daylight hours
// subtle stroke so tiles don’t visually merge
cells.append("rect")
  .attr("class", "tile")
  .attr("rx", 3)
  .attr("width",  cellW)
  .attr("height", cellH)
  .attr("fill", d => (d.fill = colorFor(d.daylightRounded, d.daylight)))
  .attr("stroke", "rgba(0,0,0,.12)")
  .attr("stroke-width", 0.6);

/* ===== weekday letters centered in the tile (hidden until hover) ===== */

// append a text element centered in each tile
// it shows the first letter of the weekday (s m t w t f s) for orientation
// it starts hidden (opacity=0) and fades in on hover
cells.append("text")
  .attr("class", "weekday-letter hover-letter")
  .attr("x", cellW / 2).attr("y", cellH / 2 + 2)
  .attr("text-anchor", "middle").attr("dominant-baseline", "middle")
  .text(d => week_letters[d.dateOnly.getDay()])
  .attr("fill", d => textColor(d.fill))     // uses the stored tile color
  .attr("opacity", 0);

/* ===== tooltip helpers (formatters + label for extremes) ===== */

// date formatter to build date line in tooltip
const fmtDate = d3.timeFormat("%B %d");   
// (ex: “June 04”)
const fmtDay  = d3.timeFormat("%A");        
// (ex: “Tuesday”)

/* ===== tooltip show/hide ===== */

//  hours formatter to turn hours in float (e.g. 5.25) into "5h 15m" format
function formatHoursHM(hoursFloat) {
  let mins = Math.round(hoursFloat * 60);
  mins = Math.max(0, Math.min(mins, 24 * 60));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

// function to show tooltip at mouse position with info for the hovered day

function showTooltip(ev, d) {
  // event handler; receives two things:
  // ev = mouse event
  // d  = data object for day hovered
  // “season” label from the rounded daylight hours
  const season = seasonLabel(d.daylightRounded);
  // format daylight hours line:
  // - if the day is exactly 0h or 24h (using the rounded value), show clean integer
  // - otherwise, show one decimal using the raw value
  const hoursText =
    (d.daylightRounded === 0 || d.daylightRounded === 24)
      ? `${d.daylightRounded} h daylight`
      : `${formatHoursHM(d.daylight)} daylight`;
  // add extra line only for the extremes (0h or 24h)
  const extremes =
    (d.daylightRounded === 0)  ? "no sunrise" :
    (d.daylightRounded === 24) ? "no sunset"  : 
    "";

  // build date line like "Tuesday, June 04"
  const dayLine = `${fmtDay(d.dateOnly)}, ${fmtDate(d.dateOnly)}`;

  // position and show the tooltip next to the mouse:
  // - set opacity to 1 so it becomes visible (CSS starts it at opacity 0)
  // - add +12px offset so the tooltip doesn’t sit right under the cursor
  tooltip
  .style("opacity", 1)
  .html(
    `${dayLine}<br>` +
    `<strong>${season}</strong><br>` +
    `${hoursText}` +
    (extremes ? `<br>${extremes}` : "")
  )
  .style("left", (ev.clientX + 12) + "px")
  .style("top",  (ev.clientY + 12) + "px");
}

// function to hide tooltip by setting opacity to 0
function hideTooltip() {
  tooltip.style("opacity", 0);
}

/* ===== hover interactions: show letter + tooltip on enter/move, reset on leave ===== */
cells
  .on("pointermove", showTooltip)
  // when the mouse first enters a tile:
  .on("pointerenter", function (ev, d) {
    // fade in the small weekday letter
    d3.select(this).select(".hover-letter").attr("opacity", 0.9);
    // brighten tile border so the hovered cell pops
    d3.select(this).select("rect.tile")
      .attr("stroke", "rgba(255,255,255,.9)")
      .attr("stroke-width", 1.2);
    // show the tooltip
    showTooltip(ev, d);
  })
  // when the mouse leaves the tile:
  .on("pointerleave", function () {
    // hide the weekday letter again
    d3.select(this).select(".hover-letter").attr("opacity", 0);
    // restore the subtle default stroke on the tile
    d3.select(this).select("rect.tile")
      .attr("stroke", "rgba(0,0,0,.12)")
      .attr("stroke-width", 0.6);
    // hide the tooltip
    hideTooltip();
  });

/* ===== endpoint labels ===== */
// top-left label just above the first tile
grid.append("text")
  .attr("class", "date-label")
  .attr("x", 4)
  .attr("y", -10)
  .text("january 1")

// bottom-right label just below the last tile
const lastI   = days.length - 1;
const lastCol = lastI % number_cols;
const lastRow = Math.floor(lastI / number_cols);
grid.append("text")
  .attr("class", "date-label")
  .attr("x", lastCol * (cellW + gutter) + 4) // inside the last tile, with a small left margin
  .attr("y", lastRow * (cellH + gutter) + cellH + 16) // below the last tile, with a small margin
  .text("december 31")

/* ===== decorative corner coordinate ===== */
// add a small text label near the top-right of the grid
grid.append("text")
  .attr("class", "corner-coord")
  .attr("x", innerW - 8)
  .attr("y", -20)
  .attr("text-anchor", "end")
  // use <tspan> to style smaller “N/W” via CSS
  .html('71.2906°<tspan class="coord-suffix">N</tspan>, 156.7886°<tspan class="coord-suffix">W</tspan>');

grid.append("image")
  .attr("href", "crosshair.png")
  .attr("x", innerW - 190)
  .attr("y", -34)
  .attr("width", 18)
  .attr("height", 18)
  .attr("opacity", 0.6);

})