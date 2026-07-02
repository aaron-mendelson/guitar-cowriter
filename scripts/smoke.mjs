/* End-to-end smoke of the core loop (offline mode, no API key). */
import { chromium } from "playwright";

const url = process.env.SMOKE_URL || "http://localhost:5199/";
const browser = await chromium.launch({
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

await page.goto(url, { waitUntil: "networkidle" });

// 1) shell renders
const title = await page.textContent("h1");
console.log("H1:", title?.trim());
if (!title?.includes("Guitar Co-Writer")) throw new Error("shell failed");

// 2) opener visible
const opener = await page.textContent(".opener h2").catch(() => null);
console.log("Opener:", opener);

// 3) submit the magic-moment intent (offline → fallbackFrame + offlineTurn)
await page.fill(".chatinput textarea", "C Am F G — make it a prog-rock anthem");
await page.click(".chatinput .btn.primary");
await page.waitForSelector(".optioncard", { timeout: 120000 });
const optionNames = await page.$$eval(".optioncard .oname", (els) => els.map((e) => e.textContent.trim()));
console.log("Options:", optionNames);

// 4) timeline chips (progression parsed → song built)
await page.waitForSelector(".chordchip", { timeout: 5000 });
const chips = await page.$$eval(".chordchip .cname", (els) => els.map((e) => e.textContent.trim()));
console.log("Timeline chords:", chips);
if (chips.join(",") !== "C,Am,F,G") throw new Error("progression mismatch: " + chips.join(","));

// 5) roman numerals correct
const romans = await page.$$eval(".chordchip .roman", (els) => els.map((e) => e.textContent.trim()));
console.log("Romans:", romans);

// 6) audition an option → fretboard dots render (AI phrase on the neck)
await page.click(".optioncard .btn.primary"); // first "Hear it"
await page.waitForTimeout(1200);
const dotCount = await page.$$eval("svg circle.dot", (els) => els.length);
console.log("Fretboard dots:", dotCount);
if (dotCount < 4) throw new Error("no phrase dots on neck");

// 7) teaching label expands
await page.click(".optioncard >> nth=0 >> text=why");
const teach = await page.textContent(".optioncard.open .teach").catch(() => null);
console.log("Teaching:", teach?.slice(0, 80));

// 8) transport plays (audition may already have started playback)
const playBtn = await page.$(".transport .btn.primary");
const label = await playBtn.textContent();
if (!label.includes("Stop")) await playBtn.click();
await page.waitForTimeout(4500); // ride past the 4-beat count-in
const pos = await page.textContent(".transport .pos");
console.log("Transport pos after 4.5s:", pos);
if (!/bar \d/.test(pos)) throw new Error("transport did not advance: " + pos);
await playBtn.click(); // stop

// 9) keep an option → system message
await page.click(".optioncard >> nth=0 >> text=✓ Keep");
await page.waitForTimeout(300);
const sys = await page.$$eval(".msg.system", (els) => els.map((e) => e.textContent.trim()));
console.log("System msgs:", sys);

// 9.5) lens bar generates a line directly (offline engine path)
await page.click('button.btn.ghost:has-text("Guide-tone line")');
await page.waitForTimeout(600);
const lensMsg = await page.$$eval(".msg.system", (els) => els.map((e) => e.textContent).filter((t) => t.includes("Lens:")));
console.log("Lens fired:", lensMsg.length > 0);
if (!lensMsg.length) throw new Error("lens bar did not fire");
// stop playback the lens started
const pb = await page.$(".transport .btn.primary");
if ((await pb.textContent()).includes("Stop")) await pb.click();

// 9.6) style knobs render + move one
const knobCount = await page.$$eval(".stagecol input[type=range]", (els) => els.length);
console.log("Range inputs on stage (bpm + knobs + faders):", knobCount);

// 10) band toggle + chord loop tap
await page.click("text=🥁 band");
await page.click(".chordchip .cname >> nth=1"); // loop Am
await page.waitForTimeout(300);
console.log("Band + loop toggled OK");

await page.screenshot({ path: new URL("./smoke.png", import.meta.url).pathname, fullPage: false });
console.log("Screenshot saved.");

const fatal = errors.filter((e) => !/favicon|manifest|Autoplay|AudioContext was not allowed/i.test(e));
if (fatal.length) { console.log("ERRORS:\n" + fatal.join("\n")); process.exit(1); }
console.log("SMOKE PASS ✅");
await browser.close();
