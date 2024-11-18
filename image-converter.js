const sharp = require("sharp");
const fs = require("fs").promises;
const path = require("path");
const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");
const { glob } = require("glob");

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
  .option("includeWebp", {
    alias: "w",
    type: "boolean",
    description: "Also optimize WebP files",
    default: false,
  })
  .option("scale", {
    alias: "s",
    type: "number",
    description: "Scale factor (e.g., 0.5 for half size)",
    default: 1,
  })
  .option("crop", {
    alias: "c",
    type: "string",
    description:
      "Crop dimensions in format: widthxheight+left+top (e.g., 100x100+0+0)",
    default: "",
  })
  .option("resize", {
    alias: "r",
    type: "string",
    description: "Resize dimensions in format: widthxheight (e.g., 800x600)",
    default: "",
  })
  .option("fit", {
    alias: "f",
    type: "string",
    description: "Resize fit: cover, contain, fill, inside, outside",
    default: "cover",
    choices: ["cover", "contain", "fill", "inside", "outside"],
  })
  .option("position", {
    alias: "p",
    type: "string",
    description: "Resize position when using 'cover' fit",
    default: "center",
    choices: [
      "center",
      "north",
      "east",
      "south",
      "west",
      "northeast",
      "southeast",
      "southwest",
      "northwest",
    ],
  })
  .help().argv;

async function getInputFiles(input, includeWebp) {
  const extensions = includeWebp
    ? "{png,jpg,jpeg,heic,webp}"
    : "{png,jpg,jpeg,heic}";

  try {
    const stats = await fs.stat(input);
    if (stats.isFile()) {
      return [input];
    } else if (stats.isDirectory()) {
      return glob(`${input}/**/*.${extensions}`, { nocase: true });
    }
  } catch {
    return glob(input, { nocase: true });
  }
}

async function calculateCropCoordinates(
  metadata,
  cropWidth,
  cropHeight,
  position = "center"
) {
  const { width, height } = metadata;

  let left = 0;
  let top = 0;

  // Calculate horizontal position
  switch (position) {
    case "west":
    case "northwest":
    case "southwest":
      left = 0;
      break;
    case "east":
    case "northeast":
    case "southeast":
      left = width - cropWidth;
      break;
    default: // center
      left = Math.max(0, Math.floor((width - cropWidth) / 2));
  }

  // Calculate vertical position
  switch (position) {
    case "north":
    case "northwest":
    case "northeast":
      top = 0;
      break;
    case "south":
    case "southwest":
    case "southeast":
      top = height - cropHeight;
      break;
    default: // center
      top = Math.max(0, Math.floor((height - cropHeight) / 2));
  }

  return { left, top };
}

async function processFiles(input, options) {
  try {
    const files = await getInputFiles(input, options.includeWebp);
    const imageFiles = files.filter((file) => {
      const ext = path.extname(file).toLowerCase();
      const validExts = options.includeWebp
        ? [".png", ".jpg", ".jpeg", ".webp"]
        : [".png", ".jpg", ".jpeg"];
      return validExts.includes(ext);
    });

    console.log(`Found ${imageFiles.length} images`);
    console.log("Using options:", options);

    for (const file of imageFiles) {
      const ext = path.extname(file).toLowerCase();
      const outputPath =
        ext === ".webp"
          ? `optimized-${file}`
          : path.join(path.dirname(file), `${path.parse(file).name}.webp`);

      const image = sharp(file);
      const metadata = await image.metadata();

      if (options.crop) {
        const cropMatch = options.crop.match(/(\d+)x(\d+)(?:\+(\d+)\+(\d+))?/);
        if (cropMatch) {
          const cropWidth = parseInt(cropMatch[1], 10);
          const cropHeight = parseInt(cropMatch[2], 10);

          // Validate crop dimensions
          if (isNaN(cropWidth) || isNaN(cropHeight)) {
            console.error("Invalid crop dimensions");
            continue;
          }

          // Check if we have manual coordinates
          if (cropMatch[3] && cropMatch[4]) {
            const left = parseInt(cropMatch[3], 10);
            const top = parseInt(cropMatch[4], 10);

            if (isNaN(left) || isNaN(top)) {
              console.error("Invalid crop coordinates");
              continue;
            }

            await image.extract({
              width: cropWidth,
              height: cropHeight,
              left,
              top,
            });
          } else {
            // Smart crop with position
            if (cropWidth > metadata.width || cropHeight > metadata.height) {
              console.error(
                `Crop dimensions (${cropWidth}x${cropHeight}) exceed image size (${metadata.width}x${metadata.height})`
              );
              continue;
            }

            const { left, top } = await calculateCropCoordinates(
              metadata,
              cropWidth,
              cropHeight,
              options.position
            );

            console.log(
              `Cropping with calculated coordinates: left=${left}, top=${top}`
            );

            await image.extract({
              width: cropWidth,
              height: cropHeight,
              left,
              top,
            });
          }
        } else {
          console.error(
            "Invalid crop format. Use: widthxheight or widthxheight+left+top"
          );
        }
      }

      if (options.resize) {
        const [width, height] = options.resize.split("x").map(Number);
        if (width && height) {
          await image.resize(width, height, {
            fit: options.fit,
            position: options.position,
          });
        }
      }

      if (options.scale !== 1) {
        const metadata = await image.metadata();
        await image.resize(
          Math.round(metadata.width * options.scale),
          Math.round(metadata.height * options.scale)
        );
      }

      await image
        .webp({
          quality: options.quality,
          lossless: options.lossless,
          effort: options.effort,
          nearLossless: options.nearLossless,
        })
        .toFile(outputPath);

      console.log(`Converted: ${file} -> ${path.basename(outputPath)}`);
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
  includeWebp: argv.includeWebp,
  scale: argv.scale,
  crop: argv.crop,
  resize: argv.resize,
  fit: argv.fit,
  position: argv.position,
});
