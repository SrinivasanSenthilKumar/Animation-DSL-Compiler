const fs = require('fs');

const compileAnimationDSL = (() => {
  class Tokenizer {
    constructor(input) { this.input = input; this.pos = 0; this.tokens = []; }
    tokenize() {
      while (!this.isEOF()) {
        this.skipWhitespace();
        if (this.isEOF()) break;
        const ch = this.peek();
        if (ch === "[" || ch === "]" || ch === ";") {
          this.tokens.push({ type: ch, value: ch, position: this.pos });
          this.advance();
          continue;
        }
        if (ch === "@") {
          const startPos = this.pos;
          this.advance();
          const timeValue = this.readWhile((c) => /[0-9.]/.test(c));
          const unit = this.readWhile((c) => /[a-zA-Z%]/.test(c));
          if (!timeValue || !unit) throw new Error(`Invalid timeline marker near position ${this.pos}`);
          this.tokens.push({ type: "TIME_MARK", value: `${timeValue}${unit}`, position: startPos });
          continue;
        }
        if (this.isWordStart(ch)) {
          const startPos = this.pos;
          const word = this.readWhile((c) => this.isWordChar(c));
          this.tokens.push({ type: this.keywordType(word), value: word, position: startPos });
          continue;
        }
        if (this.isNumberStart(ch)) {
          const startPos = this.pos;
          const numberish = this.readWhile((c) => /[0-9.+\-a-zA-Z%]/.test(c));
          this.tokens.push({ type: "VALUE", value: numberish, position: startPos });
          continue;
        }
        if (ch === "#") {
          const startPos = this.pos;
          this.advance();
          const hex = this.readWhile((c) => /[0-9a-fA-F]/.test(c));
          if (!hex) throw new Error(`Invalid color near position ${this.pos}`);
          this.tokens.push({ type: "VALUE", value: `#${hex}`, position: startPos });
          continue;
        }
        throw new Error(`Unexpected character '${ch}' at position ${this.pos}`);
      }
      this.tokens.push({ type: "EOF", value: null, position: this.pos });
      return this.tokens;
    }
    keywordType(word) {
      const keywords = new Set(["scene", "object", "shape", "position", "time", "repeat", "easing", "color", "size", "top", "bottom", "left", "right", "up", "down", "rotate", "scale", "opacity"]);
      return keywords.has(word) ? word.toUpperCase() : "IDENT";
    }
    isEOF() { return this.pos >= this.input.length; }
    peek() { return this.input[this.pos]; }
    advance() { this.pos += 1; }
    readWhile(predicate) {
      const start = this.pos;
      while (!this.isEOF() && predicate(this.peek())) this.advance();
      return this.input.slice(start, this.pos);
    }
    skipWhitespace() { this.readWhile((c) => /\s/.test(c)); }
    isWordStart(ch) { return /[a-zA-Z_]/.test(ch); }
    isWordChar(ch) { return /[a-zA-Z0-9_\-.]/.test(ch); }
    isNumberStart(ch) { return /[0-9.+\-]/.test(ch); }
  }

  class Parser {
    constructor(tokens) { this.tokens = tokens; this.pos = 0; }
    parseProgram() {
      const scene = this.parseScene();
      this.expect("EOF");
      return { type: "Program", scene };
    }
    parseScene() {
      this.expect("SCENE");
      const name = this.expect("IDENT").value;
      this.expect("[");
      const objects = [];
      while (!this.match("]")) objects.push(this.parseObject());
      this.expect("]");
      return { type: "Scene", name, objects };
    }
    parseObject() {
      this.expect("OBJECT");
      const name = this.expect("IDENT").value;
      this.expect("[");
      const properties = {};
      const timeline = [];
      while (!this.match("]")) {
        if (this.match("TIME_MARK")) {
          timeline.push(this.parseTimelineStep());
        } else {
          const prop = this.parseProperty();
          properties[prop.name] = prop.value;
        }
      }
      this.expect("]");
      return { type: "Object", name, properties, timeline };
    }
    parseProperty() {
      const token = this.consume();
      const validProperties = new Set(["SHAPE", "POSITION", "TIME", "REPEAT", "EASING", "COLOR", "SIZE", "TOP", "BOTTOM", "LEFT", "RIGHT"]);
      if (!validProperties.has(token.type)) throw new Error(`Expected property token, got ${token.type} at position ${token.position}`);
      const valueToken = this.consume();
      this.expect(";");
      return { type: "Property", name: token.value.toLowerCase(), value: valueToken.value };
    }
    parseTimelineStep() {
      const time = this.expect("TIME_MARK").value;
      const actionToken = this.consume();
      const validActions = new Set(["RIGHT", "LEFT", "UP", "DOWN", "ROTATE", "SCALE", "OPACITY"]);
      if (!validActions.has(actionToken.type)) throw new Error(`Expected timeline action, got ${actionToken.type} at position ${actionToken.position}`);
      const value = this.expectAny(["VALUE", "IDENT"]).value;
      this.expect(";");
      return { type: "TimelineStep", time, action: actionToken.value.toLowerCase(), value };
    }
    current() { return this.tokens[this.pos]; }
    consume() { return this.tokens[this.pos++]; }
    match(type) { return this.current().type === type; }
    expect(type) {
      const token = this.current();
      if (token.type !== type) throw new Error(`Expected ${type}, got ${token.type} at position ${token.position}`);
      this.pos += 1;
      return token;
    }
    expectAny(types) {
      const token = this.current();
      if (!types.includes(token.type)) throw new Error(`Expected one of ${types.join(", ")}, got ${token.type} at position ${token.position}`);
      this.pos += 1;
      return token;
    }
  }

  class CodeGenerator {
    constructor(ast) { this.ast = ast; }
    generate() {
      const scene = this.ast.scene;
      const cssBlocks = [];
      const objectHtml = [];
      cssBlocks.push(this.sceneCSS(scene.name));
      for (const obj of scene.objects) {
        const className = `${scene.name}-${obj.name}`;
        const keyframesName = `${className}-kf`;
        if (obj.properties.shape === "wave") {
          objectHtml.push(this.generateWaveSVG(className, obj));
          cssBlocks.push(this.waveSVGCSS(className, keyframesName, obj), this.keyframesCSS(keyframesName, obj));
        } else if (obj.properties.shape === "boat") {
          objectHtml.push(this.generateBoatSVG(className, obj));
          cssBlocks.push(this.objectCSS(className, keyframesName, obj), this.keyframesCSS(keyframesName, obj));
        } else {
          cssBlocks.push(this.objectCSS(className, keyframesName, obj), this.keyframesCSS(keyframesName, obj));
          objectHtml.push(`<div class="dsl-object ${className}"></div>`);
        }
      }
      return { html: `<div class="dsl-scene ${scene.name}">\n${objectHtml.join("\n")}\n</div>`, css: cssBlocks.join("\n\n") };
    }
    sceneCSS(sceneName) {
      return `* { margin: 0; padding: 0; box-sizing: border-box; }\nbody, html { width: 100%; height: 100%; overflow: hidden; }\n.dsl-scene.${sceneName} { position: relative; width: 100vw; height: 100vh; overflow: hidden; background: linear-gradient(180deg, #87ceeb 0%, #4682b4 100%); }`;
    }
    objectCSS(className, keyframesName, obj) {
      const p = obj.properties;
      const duration = p.time || "1s";
      const repeat = p.repeat || "1";
      const easing = p.easing || "linear";
      const position = p.position || "absolute";
      const top = p.top ? `top: ${p.top};` : "";
      const bottom = p.bottom ? `bottom: ${p.bottom};` : "";
      const left = p.left ? `left: ${p.left};` : "";
      const right = p.right ? `right: ${p.right};` : "";
      const finalPositioning = [top, bottom, left, right].filter(Boolean).join("\n  ") || "top: 0px;\n  left: 0px;";
      return `.dsl-object.${className} {\n  position: ${position};\n  ${finalPositioning}\n  ${this.shapeStyles(p.shape, p.size, p.color)}\n  animation: ${keyframesName} ${duration} ${easing} ${repeat};\n}`;
    }
    generateWaveSVG(className, obj) {
      const p = obj.properties;
      let widthVal = 1200, isPercent = false;
      if (p.size && p.size.endsWith("%")) { isPercent = true; widthVal = 2e3; } 
      else { widthVal = this.parseNumeric(p.size) || 1200; }
      const containerHeight = isPercent ? "100%" : `${Math.floor(widthVal * 0.5)}px`;
      const resolvedColor = this.resolveColor(p.color || "#4da6ff");
      const svgs = [];
      for (let layer = 0; layer < 3; layer++) {
        const waveColor = this.adjustColorBrightness(resolvedColor, 1 + layer * 0.1);
        svgs.push(`  <svg class="wave-layer wave-layer-${layer}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${widthVal * 2} 1000" preserveAspectRatio="none">${this.generateWaveGroupPath(widthVal * 2, 1000, 100 - layer * 20, 3 + layer, waveColor, 0.8 - layer * 0.2)}</svg>`);
      }
      return `  <div class="dsl-object dsl-wave ${className}" style="width: ${isPercent ? p.size : `${widthVal}px`}; height: ${containerHeight};">\n  ${svgs.join("\n  ")}\n  </div>`;
    }
    generateBoatSVG(className, obj) {
      const size = obj.properties.size || "100px";
      const color = obj.properties.color ? this.resolveColor(obj.properties.color) : "#8B4513";
      return `  <div class="dsl-object ${className}" style="width: ${size}; height: ${size};"><svg viewBox="0 0 100 100" width="100%" height="100%"><path d="M52,10 L90,60 L52,60 Z" fill="#f8fafc" stroke="#cbd5e1" stroke-width="2" /><path d="M48,15 L20,60 L48,60 Z" fill="#f1f5f9" stroke="#cbd5e1" stroke-width="2" /><rect x="48" y="5" width="4" height="65" fill="#475569" /><path d="M10,65 L30,90 L70,90 L95,65 Z" fill="${color}" /><circle cx="40" cy="77" r="4" fill="#334155" /><circle cx="60" cy="77" r="4" fill="#334155" /></svg></div>`;
    }
    generateWaveGroupPath(width, height, amplitude, frequency, color, opacity) {
      const baseY = height * 0.45, points = 300;
      let path = `M 0,${baseY}`;
      for (let i = 0; i <= points; i++) {
        const x = width / points * i;
        path += ` L ${x},${baseY + Math.sin(x / width * Math.PI * 2 * frequency) * amplitude}`;
      }
      return `<path d="${path} L ${width},${height} L 0,${height} Z" fill="${color}" opacity="${opacity}"/>`;
    }
    adjustColorBrightness(color, factor) {
      if (!color.startsWith("#")) return color;
      const hex = color.replace("#", "");
      const r = Math.min(255, Math.floor(parseInt(hex.substring(0, 2), 16) * factor));
      const g = Math.min(255, Math.floor(parseInt(hex.substring(2, 4), 16) * factor));
      const b = Math.min(255, Math.floor(parseInt(hex.substring(4, 6), 16) * factor));
      return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
    }
    waveSVGCSS(className, keyframesName, obj) {
      const p = obj.properties;
      const finalPositioning = [p.top ? `top: ${p.top};` : "", p.bottom ? `bottom: ${p.bottom};` : "", p.left ? `left: ${p.left};` : "", p.right ? `right: ${p.right};` : ""].filter(Boolean).join("\n  ") || "top: 0px;\n  left: 0px;";
      return `.dsl-wave.${className} { position: ${p.position || "absolute"}; ${finalPositioning} overflow: hidden; }\n.dsl-wave.${className} .wave-layer { position: absolute; top: 0; left: 0; width: 200%; height: 100%; }\n.dsl-wave.${className} .wave-layer-0 { animation: wave-motion-1 ${p.time || "1s"} ${p.easing || "linear"} ${p.repeat || "1"}; }\n.dsl-wave.${className} .wave-layer-1 { animation: wave-motion-2 calc(${p.time || "1s"} * 1.3) ${p.easing || "linear"} ${p.repeat || "1"}; }\n.dsl-wave.${className} .wave-layer-2 { animation: wave-motion-3 calc(${p.time || "1s"} * 1.7) ${p.easing || "linear"} ${p.repeat || "1"}; }\n@keyframes wave-motion-1 { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }\n@keyframes wave-motion-2 { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }\n@keyframes wave-motion-3 { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }`;
    }
    keyframesCSS(name, obj) {
      const durationSeconds = this.toSeconds(obj.properties.time || "1s");
      const stateByTime = this.buildAccumulatedState(obj.timeline);
      const lines = [`@keyframes ${name} {`];
      for (const [t, _] of stateByTime) {
        const s = stateByTime.get(t);
        lines.push(`  ${Math.min(100, Math.max(0, t / durationSeconds * 100)).toFixed(2)}% { transform: translate(${s.x}px, ${s.y}px) rotate(${s.rotate}deg) scale(${s.scale}); opacity: ${s.opacity}; }`);
      }
      lines.push("}");
      return lines.join("\n");
    }
    buildAccumulatedState(steps) {
      const grouped = new Map();
      for (const step of steps) {
        const sec = this.toSeconds(step.time);
        if (!grouped.has(sec)) grouped.set(sec, []);
        grouped.get(sec).push(step);
      }
      const timeline = new Map(), state = { x: 0, y: 0, rotate: 0, scale: 1, opacity: 1 };
      timeline.set(0, { ...state });
      Array.from(grouped.keys()).sort((a, b) => a - b).forEach(time => {
        grouped.get(time).forEach(step => this.applyStep(state, step));
        timeline.set(time, { ...state });
      });
      return timeline;
    }
    applyStep(state, step) {
      const numeric = this.parseNumeric(step.value);
      switch (step.action) {
        case "right": state.x += numeric; break;
        case "left": state.x -= numeric; break;
        case "up": state.y -= numeric; break;
        case "down": state.y += numeric; break;
        case "rotate": state.rotate += numeric; break;
        case "scale": state.scale *= numeric; break;
        case "opacity": state.opacity = numeric; break;
        default: throw new Error(`Unsupported action: ${step.action}`);
      }
    }
    shapeStyles(shape = "square", size, color) {
      const resolvedColor = this.resolveColor(color || "black"), finalSize = size || "50px";
      if (shape === "circle") return `width: ${finalSize}; height: ${finalSize}; background: ${resolvedColor}; border-radius: 50%;`;
      if (shape === "wave" || shape === "boat") return `display: block;`;
      return `width: ${finalSize}; height: ${finalSize}; background: ${resolvedColor};`;
    }
    resolveColor(color) {
      if (!color) return "#3b82f6";
      if (color.startsWith("#") || color.startsWith("rgb") || ["red", "blue", "green", "yellow", "black", "white", "orange", "pink", "purple", "gray", "indigo", "teal", "cyan"].includes(color)) return color;
      const tailwindColors = { "yellow-400": "#facc15", "blue-600": "#2563eb", "blue-500": "#3b82f6" };
      return tailwindColors[color] || color;
    }
    toSeconds(timeLiteral) {
      const m = /^([0-9]*\.?[0-9]+)(ms|s)$/.exec(String(timeLiteral).trim());
      if (!m) throw new Error(`Invalid time literal: ${timeLiteral}`);
      return m[2] === "ms" ? parseFloat(m[1]) / 1e3 : parseFloat(m[1]);
    }
    parseNumeric(valueLiteral) {
      if (!valueLiteral) return 0;
      const n = parseFloat(String(valueLiteral).replace(/[^0-9.+\-]/g, ""));
      return Number.isNaN(n) ? 0 : n;
    }
  }

  return function(dslInput) {
    try {
      const ast = new Parser(new Tokenizer(dslInput).tokenize()).parseProgram();
      const output = new CodeGenerator(ast).generate();
      return { html: output.html, css: output.css, ast };
    } catch (err) { return { html: "", css: "", error: err.message }; }
  };
})();

console.log("🌊 Pineapple Pizza DSL Compiler 🌊");
console.log("----------------------------------");
console.log("Please paste or type your animation DSL code below.");
console.log("Press Ctrl+D (Mac/Linux) or Ctrl+Z then Enter (Windows) when finished:\n");

let dslInput = '';

process.stdin.setEncoding('utf8');

process.stdin.on('data', (chunk) => {
  dslInput += chunk;
});

process.stdin.on('end', () => {
  const input = dslInput.trim();
  if (!input) {
    console.error("\n❌ No input provided. Exiting.");
    process.exit(1);
  }

  console.log("\n⚙️ Compiling DSL...");
  
  const result = compileAnimationDSL(input);
  
  if (result.error) {
    console.error("\n❌ Compilation Failed:");
    console.error(result.error);
    process.exit(1);
  }

  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Compiled Animation</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
${result.html}
</body>
</html>`;

  try {
    fs.writeFileSync('index.html', htmlContent);
    fs.writeFileSync('styles.css', result.css);
    console.log("\n✅ Compilation Successful!");
    console.log("📁 Created: index.html");
    console.log("📁 Created: styles.css");
    console.log("\n🚀 Open index.html in your browser to view the animation!");
  } catch (err) {
    console.error("\n❌ Failed to write files:", err.message);
  }
});