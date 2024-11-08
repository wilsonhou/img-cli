const sharp = require("sharp");
const fs = require("fs").promises;
const path = require("path");
const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");
const { glob } = require("glob");
const { optimize } = require("svgo");

const argv = yargs(hideBin(process.argv))
  .option("input", {
    alias: "i",
    type: "string",
    description: "Input path (folder, file, or glob pattern)",
    demandOption: true,
  })
  .option("quality", {
    alias: "q",
    type: "number",
    description: "WebP quality (0-100)",
    default: 80,
  })
  .option("lossless", {
    alias: "l",
    type: "boolean",
    description: "Use lossless compression",
    default: false,
  })
  .option("effort", {
    alias: "e",
    type: "number",
    description: "Compression effort (0-6)",
    default: 6,
  })
  .option("nearLossless", {
    alias: "n",
    type: "boolean",
    description: "Enable near-lossless mode",
    default: false,
  })
  .help().argv;

async function getInputFiles(input) {
  try {
    const stats = await fs.stat(input);
    if (stats.isFile()) {
      return [input];
    } else if (stats.isDirectory()) {
      return glob(`${input}/**/*.{png,jpg,jpeg,svg}`, { nocase: true });
    }
  } catch {
    return glob(input, { nocase: true });
  }
}

async function optimizeSvg(filePath) {
  // Create backup file
  const backupPath = `${filePath}.backup`;
  const svgString = await fs.readFile(filePath, "utf8");

  // Save backup if it doesn't exist
  try {
    await fs.access(backupPath);
  } catch {
    await fs.writeFile(backupPath, svgString);
    console.log(`Backup created: ${backupPath}`);
  }

  const result = optimize(svgString, {
    multipass: true,
    plugins: [
      "preset-default",
      "removeDimensions",
      "removeViewBox",
      {
        name: "removeAttrs",
        params: { attrs: "(stroke|fill)" },
      },
    ],
  });

  await fs.writeFile(filePath, result.data);
  console.log(`Optimized: ${filePath}`);
}

async function processFiles(input, options) {
  try {
    const files = await getInputFiles(input);
    const rasterFiles = [];
    const svgFiles = [];

    files.forEach((file) => {
      const ext = path.extname(file).toLowerCase();
      if (ext === ".svg") {
        svgFiles.push(file);
      } else if ([".png", ".jpg", ".jpeg"].includes(ext)) {
        rasterFiles.push(file);
      }
    });

    console.log(
      `Found ${rasterFiles.length} raster images and ${svgFiles.length} SVG files`
    );
    console.log("Using options:", options);

    // Process raster images
    for (const file of rasterFiles) {
      const outputPath = path.join(
        path.dirname(file),
        `${path.parse(file).name}.webp`
      );

      await sharp(file)
        .webp({
          quality: options.quality,
          lossless: options.lossless,
          effort: options.effort,
          nearLossless: options.nearLossless,
        })
        .toFile(outputPath);

      console.log(`Converted: ${file} -> ${path.basename(outputPath)}`);
    }

    // Process SVG files
    for (const file of svgFiles) {
      await optimizeSvg(file);
    }

    console.log("Processing completed successfully!");
  } catch (error) {
    console.error("An error occurred:", error);
  }
}

processFiles(argv.input, {
  quality: argv.quality,
  lossless: argv.lossless,
  effort: argv.effort,
  nearLossless: argv.nearLossless,
});
