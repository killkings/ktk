import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/*
 * Execute com: node tools/gerar_catalogo_lpc.mjs
 * Se a fonte LPC não estiver ao lado do jogo, o script baixa somente as pastas
 * necessárias, na revisão imutável definida em js/lpc-config.js, para uma pasta
 * temporária e a remove no final. KTK_LPC_SOURCE_DIR permite apontar para uma
 * cópia já existente, desde que esteja na mesma revisão fixada.
 */
const GAME_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_FILE = path.join(GAME_ROOT, "js", "lpc-config.js");
const configSource = await fs.readFile(CONFIG_FILE, "utf8");
const configMarker = "const LPC_SOURCE_CONFIG =";
const configStart = configSource.indexOf(configMarker);
const configEnd = configSource.indexOf(";", configStart);
if (configStart < 0 || configEnd < 0) {
  throw new Error("Não foi possível ler a configuração LPC em js/lpc-config.js.");
}
const LPC_SOURCE_CONFIG = JSON.parse(
  configSource.slice(configStart + configMarker.length, configEnd).trim(),
);

function runGit(cwd, args) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const detail = error.stderr?.toString().trim() || error.message;
    throw new Error("Falha no Git (" + args.join(" ") + "): " + detail, { cause: error });
  }
}

async function hasRequiredLpcFolders(root) {
  try {
    await Promise.all([
      fs.access(path.join(root, "sheet_definitions")),
      fs.access(path.join(root, "spritesheets", "hair")),
      fs.access(path.join(root, "spritesheets", "beards")),
    ]);
    return true;
  } catch {
    return false;
  }
}

async function isPinnedLpcSource(root) {
  if (!(await hasRequiredLpcFolders(root))) return false;
  try {
    return runGit(root, ["rev-parse", "HEAD"]).trim() === LPC_SOURCE_CONFIG.revision;
  } catch {
    return false;
  }
}

async function resolveLpcSource() {
  const override = process.env.KTK_LPC_SOURCE_DIR;
  if (override) {
    const root = path.resolve(override);
    if (!(await isPinnedLpcSource(root))) {
      throw new Error(
        "KTK_LPC_SOURCE_DIR precisa ser um checkout Git válido na revisão " +
          LPC_SOURCE_CONFIG.revision + ": " + root,
      );
    }
    return { root, cleanup: null, downloaded: false };
  }

  const existing = path.join(
    GAME_ROOT,
    "Universal-LPC-Spritesheet-Character-Generator-master",
  );
  if (await isPinnedLpcSource(existing)) {
    return { root: existing, cleanup: null, downloaded: false };
  }

  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ktk-lpc-catalog-"));
  try {
    runGit(GAME_ROOT, ["init", "--quiet", temporaryRoot]);
    runGit(temporaryRoot, ["remote", "add", "origin", LPC_SOURCE_CONFIG.repository]);
    runGit(temporaryRoot, ["sparse-checkout", "init", "--cone"]);
    runGit(temporaryRoot, [
      "sparse-checkout",
      "set",
      "sheet_definitions",
      "spritesheets/hair",
      "spritesheets/beards",
    ]);

    try {
      runGit(temporaryRoot, [
        "fetch",
        "--depth=1",
        "--filter=blob:none",
        "origin",
        LPC_SOURCE_CONFIG.revision,
      ]);
    } catch {
      // Compatibilidade com instalações de Git que não aceitem partial clone.
      runGit(temporaryRoot, ["fetch", "--depth=1", "origin", LPC_SOURCE_CONFIG.revision]);
    }
    runGit(temporaryRoot, ["checkout", "--quiet", "--detach", "FETCH_HEAD"]);

    if (!(await isPinnedLpcSource(temporaryRoot))) {
      throw new Error("O checkout LPC não corresponde à revisão fixada ou está incompleto.");
    }
    return {
      root: temporaryRoot,
      downloaded: true,
      cleanup: () => fs.rm(temporaryRoot, { recursive: true, force: true }),
    };
  } catch (error) {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
    throw new Error(
      "Não consegui preparar a fonte LPC na revisão " +
        LPC_SOURCE_CONFIG.revision +
        ". Verifique se Git e acesso ao GitHub estão disponíveis. " +
        error.message,
      { cause: error },
    );
  }
}

const lpcSource = await resolveLpcSource();
const LPC_ROOT = lpcSource.root;
const DEFINITIONS_ROOT = path.join(LPC_ROOT, "sheet_definitions");
const SPRITES_ROOT = path.join(LPC_ROOT, "spritesheets");
const OUTPUT_FILE = path.join(GAME_ROOT, "personagem.js");

try {
  if (lpcSource.downloaded) {
    console.log("Fonte LPC preparada na revisão " + LPC_SOURCE_CONFIG.revision + ".");
  }
const BODY_TYPES = ["male", "female"];

// Rótulos traduzidos a partir dos nomes oficiais em sheet_definitions.
// As chaves são os IDs oficiais dos arquivos; qualquer item novo exige tradução.
const PORTUGUESE_NAMES = {
  hair_afro: "Afro",
  hair_balding: "Calvície parcial",
  hair_bangs: "Franja",
  hair_bangs_bun: "Coque com franja",
  hair_bangslong: "Franja longa",
  hair_bangslong2: "Franja longa 2",
  hair_bangsshort: "Franja curta",
  hair_bedhead: "Despenteado ao acordar",
  hair_bob: "Chanel",
  hair_bob_side_part: "Chanel com risca lateral",
  hair_braid: "Trança",
  hair_braid2: "Trança longa",
  hair_bunches: "Rabos duplos",
  hair_buzzcut: "Raspado",
  hair_cornrows: "Tranças rentes à cabeça",
  hair_cowlick: "Mecha rebelde",
  hair_cowlick_tall: "Mecha rebelde alta",
  hair_curly_long: "Cacheado longo",
  hair_curly_short: "Cacheado curto",
  hair_curly_short2: "Cacheado curto 2",
  hair_curls_large: "Cachos grandes",
  hair_curls_large_xlong: "Cachos grandes muito longos",
  hair_curtains: "Franja cortina",
  hair_curtains_long: "Franja cortina longa",
  hair_dreadlocks_long: "Dreadlocks longos",
  hair_dreadlocks_short: "Dreadlocks curtos",
  hair_flat_top_fade: "Corte reto com degradê",
  hair_flat_top_straight: "Corte reto alto",
  hair_half_up: "Meio preso",
  hair_halfmessy: "Meio despenteado",
  hair_high_and_tight: "Militar alto e curto",
  hair_high_ponytail: "Rabo de cavalo alto",
  hair_idol: "Corte idol",
  hair_jewfro: "Afro volumoso",
  hair_lob: "Chanel longo",
  hair_long: "Longo",
  hair_long_band: "Longo com faixa",
  hair_long_center_part: "Longo repartido ao meio",
  hair_long_messy: "Longo despenteado",
  hair_long_messy2: "Longo despenteado 2",
  hair_long_straight: "Longo liso",
  hair_long_tied: "Longo amarrado",
  hair_longhawk: "Moicano longo",
  hair_loose: "Solto",
  hair_messy1: "Despenteado 1",
  hair_messy2: "Despenteado 2",
  hair_messy3: "Despenteado 3",
  hair_mop: "Corte tigela",
  hair_natural: "Natural",
  hair_page: "Corte page",
  hair_page2: "Corte page 2",
  hair_parted: "Repartido",
  hair_parted2: "Repartido 2",
  hair_parted3: "Repartido lateral",
  hair_parted_side_bangs: "Repartido com franja lateral",
  hair_parted_side_bangs2: "Repartido com franja lateral 2",
  hair_pigtails: "Maria-chiquinhas",
  hair_pigtails_bangs: "Maria-chiquinhas com franja",
  hair_pixie: "Corte pixie",
  hair_plain: "Curto simples",
  hair_ponytail: "Rabo de cavalo",
  hair_ponytail2: "Rabo de cavalo 2",
  hair_princess: "Preso estilo princesa",
  hair_relm_ponytail: "Rabo de cavalo estilo Relm",
  hair_relm_short: "Curto estilo Relm",
  hair_relm_xlong: "Muito longo estilo Relm",
  hair_sara: "Longo estilo Sara",
  hair_shorthawk: "Moicano curto",
  hair_shoulderl: "Cabelo sobre o ombro esquerdo",
  hair_shoulderr: "Cabelo sobre o ombro direito",
  hair_single: "Rabo lateral único",
  hair_spiked: "Arrepiado",
  hair_spiked2: "Arrepiado 2",
  hair_spiked_beehive: "Arrepiado estilo colmeia",
  hair_spiked_liberty: "Crista espetada",
  hair_spiked_liberty2: "Crista espetada 2",
  hair_spiked_porcupine: "Arrepiado eriçado",
  hair_swoop: "Franja varrida para o lado",
  hair_swoop_side: "Franja varrida lateral",
  hair_topknot_long: "Coque alto longo",
  hair_topknot_long2: "Coque alto longo 2",
  hair_topknot_short: "Coque alto curto",
  hair_topknot_short2: "Coque alto curto 2",
  hair_twists_fade: "Torções com degradê",
  hair_twists_straight: "Torções retas",
  hair_unkempt: "Desalinhado",
  hair_wavy: "Ondulado",
  hair_xlong: "Muito longo",
  hair_xlong_wavy: "Muito longo ondulado",
  beards_5oclock_shadow: "Barba por fazer",
  beards_beard: "Barba básica",
  beards_medium: "Barba média",
  beards_trimmed: "Barba aparada",
  beards_winter: "Barba de inverno",
  beards_bigstache: "Bigode grande",
  beards_chevron: "Bigode em V",
  beards_french: "Bigode francês",
  beards_handlebar: "Bigode de guidão",
  beards_horseshoe: "Bigode ferradura",
  beards_lampshade: "Bigode tipo abajur",
  beards_mustache: "Bigode básico",
  beards_walrus: "Bigode morsa",
};


async function listFiles(directory) {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await listFiles(fullPath)));
    else if (entry.isFile()) result.push(fullPath);
  }
  return result;
}

async function listJsonFiles(directory) {
  return (await listFiles(directory)).filter((file) => file.endsWith(".json"));
}

function portable(value) {
  return value.split(path.sep).join("/");
}

async function readWalkLayers(definition, itemId, definitionPath) {
  const layersByGender = {};
  for (const bodyType of BODY_TYPES) {
    const layers = [];
    for (let index = 1; index <= 9; index += 1) {
      const layer = definition["layer_" + index];
      if (!layer) break;
      const folder = layer[bodyType];
      if (typeof folder !== "string" || !folder.trim()) continue;
      const spritePath = portable(path.posix.join(folder.replaceAll("\\", "/"), "walk.png"));
      const absolutePath = path.resolve(SPRITES_ROOT, ...spritePath.split("/"));
      const insideSprites = absolutePath.startsWith(SPRITES_ROOT + path.sep);
      if (!insideSprites) {
        throw new Error("Caminho de sprite fora da pasta LPC: " + spritePath);
      }
      try {
        await fs.access(absolutePath);
      } catch {
        throw new Error(
          "Sprite de caminhada ausente para " +
            itemId +
            " (" +
            bodyType +
            "): " +
            spritePath +
            " — definição " +
            definitionPath,
        );
      }
      layers.push({ z: Number(layer.zPos ?? 0), path: spritePath });
    }
    layersByGender[bodyType] = layers;
  }
  return layersByGender;
}

async function buildCategory(typeName) {
  const files = await listJsonFiles(DEFINITIONS_ROOT);
  const records = [];
  for (const filePath of files) {
    if (path.basename(filePath).startsWith("meta_")) continue;
    const definition = JSON.parse(await fs.readFile(filePath, "utf8"));
    if (definition.ignore || definition.type_name !== typeName) continue;
    if (definition.animations && !definition.animations.includes("walk")) continue;

    const itemId = path.basename(filePath, ".json");
    const required = BODY_TYPES.filter(
      (bodyType) => typeof definition.layer_1?.[bodyType] === "string",
    );
    if (required.length === 0) continue;

    const definitionPath = portable(path.relative(DEFINITIONS_ROOT, filePath));
    const name = PORTUGUESE_NAMES[itemId];
    if (!name) {
      throw new Error(
        "Falta tradução para o item oficial " +
          itemId +
          " (" +
          definition.name +
          ") em PORTUGUESE_NAMES.",
      );
    }

    const layers = await readWalkLayers(definition, itemId, definitionPath);
    const availableFor = required.filter(
      (bodyType) => layers[bodyType].length > 0,
    );
    if (availableFor.length === 0) continue;

    records.push({
      id: itemId,
      name,
      sourceName: definition.name ?? itemId,
      definition: definitionPath,
      availableFor,
      layers,
      priority: definition.priority ?? Number.POSITIVE_INFINITY,
    });
  }

  records.sort(
    (a, b) =>
      a.priority - b.priority ||
      a.sourceName.localeCompare(b.sourceName, "en"),
  );
  return records.map(({ priority: _priority, ...record }) => record);
}

const [hair, beard, mustache] = await Promise.all([
  buildCategory("hair"),
  buildCategory("beard"),
  buildCategory("mustache"),
]);

const adultHairWalkFiles = (await listFiles(path.join(SPRITES_ROOT, "hair")))
  .filter(
    (file) =>
      file.endsWith(path.sep + "walk.png") &&
      file.includes(path.sep + "adult" + path.sep),
  )
  .map((file) => portable(path.relative(SPRITES_ROOT, file)));
const referencedHairFiles = new Set(
  hair.flatMap((item) =>
    BODY_TYPES.flatMap((bodyType) =>
      item.layers[bodyType].map((layer) => layer.path),
    ),
  ),
);
const unreferencedAdultHairFiles = adultHairWalkFiles.filter(
  (file) => !referencedHairFiles.has(file),
);
const unregisteredStyles = unreferencedAdultHairFiles.filter(
  (file) => !file.startsWith("hair/extensions/"),
);
if (unregisteredStyles.length > 0) {
  throw new Error(
    "Sprites adultos fora das definições oficiais do catálogo: " +
      unregisteredStyles.join(", "),
  );
}

const beardSpriteFiles = (await listFiles(path.join(SPRITES_ROOT, "beards")))
  .filter((file) => file.endsWith(path.sep + "walk.png"))
  .map((file) => portable(path.relative(SPRITES_ROOT, file)));
const referencedFaceHairFiles = new Set(
  [...beard, ...mustache].flatMap((item) =>
    BODY_TYPES.flatMap((bodyType) =>
      item.layers[bodyType].map((layer) => layer.path),
    ),
  ),
);
const unreferencedFaceHairFiles = beardSpriteFiles.filter(
  (file) => !referencedFaceHairFiles.has(file),
);
if (unreferencedFaceHairFiles.length > 0) {
  throw new Error(
    "Sprites de barba/bigode fora do catálogo oficial: " +
      unreferencedFaceHairFiles.join(", "),
  );
}

if (hair.length !== 89 || beard.length !== 5 || mustache.length !== 8) {
  throw new Error(
    "Catálogo inesperado no LPC: " +
      hair.length +
      " cabelos, " +
      beard.length +
      " barbas e " +
      mustache.length +
      " bigodes.",
  );
}

const previous = await fs.readFile(OUTPUT_FILE, "utf8");
const sourcePalettes = previous.match(/window\.KTKHairSourcePalettes=.*?;/s)?.[0];
const hairPalettes = previous.match(/window\.KTKHairPalettes=.*?;/s)?.[0];
if (!sourcePalettes || !hairPalettes) {
  throw new Error("Não encontrei as paletas de cabelo atuais em personagem.js.");
}

const beardOptions = [
  {
    id: "none",
    name: "Sem barba",
    sourceName: "None",
    definition: "",
    availableFor: BODY_TYPES,
    layers: { male: [], female: [] },
  },
  ...beard,
];
const mustacheOptions = [
  {
    id: "none",
    name: "Sem bigode",
    sourceName: "None",
    definition: "",
    availableFor: BODY_TYPES,
    layers: { male: [], female: [] },
  },
  ...mustache,
];

const output =
  "/* Gerado de sheet_definitions do Universal LPC; IDs, camadas e nomes de origem oficiais. */\n" +
  "window.KTKHairStyles=" +
  JSON.stringify(hair) +
  ";\nwindow.KTKBeardStyles=" +
  JSON.stringify(beardOptions) +
  ";\nwindow.KTKMustacheStyles=" +
  JSON.stringify(mustacheOptions) +
  ";\n" +
  sourcePalettes +
  "\n" +
  hairPalettes +
  "\n";

await fs.writeFile(OUTPUT_FILE, output, "utf8");
const layerCount = (records) =>
  records.reduce(
    (sum, record) =>
      sum +
      BODY_TYPES.reduce(
        (genderSum, bodyType) => genderSum + record.layers[bodyType].length,
        0,
      ),
    0,
  );
console.log(
  "Catálogo LPC gerado: " +
    hair.length +
    " cabelos (" +
    layerCount(hair) +
    " caminhos de camada somando masculino e feminino), " +
    beard.length +
    " barbas (" +
    layerCount(beard) +
    " caminhos de camada somando masculino e feminino) e " +
    mustache.length +
    " bigodes (" +
    layerCount(mustache) +
    " caminhos de camada somando masculino e feminino). Todos os PNGs walk exigidos foram encontrados.",
);
console.log(
  "spritesheets/hair: " +
    adultHairWalkFiles.length +
    " PNGs walk adultos; " +
    referencedHairFiles.size +
    " caminhos usados pelas opções; " +
    unreferencedAdultHairFiles.length +
    " peças extras em extensions.",
);
console.log(
  "spritesheets/beards: " +
    beardSpriteFiles.length +
    " PNGs walk; " +
    referencedFaceHairFiles.size +
    " caminhos referenciados pelas opções.",
);
} finally {
  await lpcSource.cleanup?.();
}
