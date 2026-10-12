/**
 * The press: authored fictional outlets and the people who write for them.
 *
 * WHY THESE ARE INVENTED, AND WHY THAT MATTERS. A newspaper story needs a name on the masthead to read as
 * a story rather than as the app talking to itself. Putting a real newsroom's name above a sentence this app
 * wrote would be the one thing this feature must never do: it would attribute invented words to real
 * journalists. So every outlet here is FICTIONAL, and every byline is a fictional person. They are parody
 * names, written to feel like the football press without borrowing anyone's identity.
 *
 * THIS IS REFERENCE DATA, the same as the trophy catalogue: not read from the save, editable in one place,
 * and wrong-looking only here if it is wrong. A missing nation falls back to the international wire rather
 * than leaving a story unsigned.
 *
 * A byline is chosen by the STORY's own id, so a reload shows the same paper and a new in-game day reshuffles
 * it, exactly like the rest of the desk's phrasing. A nation's own press is drawn on first, because a career
 * in Denmark should be read about in Danish football papers that do not exist rather than in invented English
 * ones, and the wire is the pool that reaches every career everywhere.
 *
 * THE DATELINE IS THE CLUB'S OWN NAME, upper-cased, not an invented town. "Wigan Athletic" files from WIGAN.
 * A city would be a fact nobody supplied.
 */

export interface PressWriter {
  name: string;
  /** The desk they sit on. Shown with the byline so a piece reads like a piece. */
  role: string;
}

/**
 * How an outlet writes about a football club.
 *
 * This is what makes a column possible. The same facts filed by a fanzine and by a hostile tabloid are two
 * different pieces and neither of them is dishonest: a paper's line on a manager is part of what the paper
 * is, and a reader already knows which of them he is reading. Nothing here changes a fact - a stance only
 * decides what an outlet makes of one.
 *
 * STRAIGHT reports it. LOYAL defends the club and looks for the explanation rather than the verdict.
 * HOSTILE doubts the manager and says so. SENSATIONAL takes a small thing and makes it the story.
 */
export type OutletStance = "STRAIGHT" | "LOYAL" | "HOSTILE" | "SENSATIONAL";

/**
 * What a paper of this kind sounds like, when the outlet itself does not say.
 *
 * A tabloid is sensational and a fanzine is loyal by construction, so deriving the default from the house
 * means every outlet on file has a stance without thirty literals having to be edited by hand, and the
 * ones that genuinely differ - a broadsheet that has it in for the manager - say so explicitly.
 */
function houseStance(house: PressOutlet["house"]): OutletStance {
  switch (house) {
    case "TABLOID":
      return "SENSATIONAL";
    case "FAN":
      return "LOYAL";
    default:
      return "STRAIGHT";
  }
}

export interface PressOutlet {
  /** Stable key. Never shown; used for the checks and for the fallback ordering. */
  key: string;
  name: string;
  /** How the outlet writes, so the desk can lean a headline toward the right kind of paper. */
  house: "BROADSHEET" | "TABLOID" | "WIRE" | "ANALYTICS" | "FAN";
  /** The outlet's line on the club. Omitted where the house already implies it. */
  stance?: OutletStance;
  writers: readonly PressWriter[];
}

/** The wire, reachable from every career in every country. */
const WIRE: readonly PressOutlet[] = [
  {
    key: "continental-wire",
    name: "Continental Sport Wire",
    house: "WIRE",
    writers: [
      { name: "Ana Beltrán", role: "Chief Football Correspondent" },
      { name: "Peter Osei", role: "Senior Football Reporter" },
      { name: "Mika Lindqvist", role: "European Correspondent" },
      { name: "Dana Whitlock", role: "Staff Writer" },
    ],
  },
  {
    key: "ninety-plus",
    name: "Ninety Plus",
    house: "ANALYTICS",
    writers: [
      { name: "Ravi Chandrasekhar", role: "Data Editor" },
      { name: "Elena Vogt", role: "Tactics Writer" },
      { name: "Tomas Kirby", role: "Analyst" },
    ],
  },
  {
    // Deliberately on the wire, so EVERY career has one outlet willing to lead with a manager's future. A
    // hostile column is only possible if the pack a career is filed with contains somewhere to put it, and
    // a nation whose own press is all broadsheets would otherwise have no such paper at all.
    key: "the-hard-tackle",
    name: "The Hard Tackle",
    house: "TABLOID",
    stance: "HOSTILE",
    writers: [
      { name: "Desmond Croker", role: "Columnist" },
      { name: "Rita Vance", role: "Chief Writer" },
      { name: "Marlon Deeds", role: "Opinion Editor" },
    ],
  },
];

/** The English-language football press, used wherever a career's nation has no pool of its own. */
const ENGLISH: readonly PressOutlet[] = [
  {
    key: "the-touchline",
    name: "The Touchline",
    house: "BROADSHEET",
    writers: [
      { name: "Marcus Bellweather", role: "Chief Football Writer" },
      { name: "Harriet Doyle", role: "Senior Sports Correspondent" },
      { name: "Owen Fairhurst", role: "Football Reporter" },
      { name: "Nadia Okonjo", role: "Columnist" },
      { name: "Gil Travers", role: "Northern Football Writer" },
    ],
  },
  {
    key: "final-whistle",
    name: "Final Whistle",
    house: "TABLOID",
    writers: [
      { name: "Danny Rourke", role: "Chief Sports Writer" },
      { name: "Kayleigh Frost", role: "Football Reporter" },
      { name: "Sonny Meade", role: "Transfer Correspondent" },
      { name: "Bethan Pryce", role: "Match Reporter" },
    ],
  },
  {
    key: "the-terrace",
    name: "The Terrace",
    house: "FAN",
    writers: [
      { name: "Jonah Pickersgill", role: "Club Correspondent" },
      { name: "Ruth Salter", role: "Feature Writer" },
      { name: "Callum Ndiaye", role: "Supporters' Editor" },
    ],
  },
  {
    key: "matchday-post",
    name: "Matchday Post",
    house: "TABLOID",
    writers: [
      { name: "Vince Halloran", role: "Sports Editor" },
      { name: "Priya Raghunathan", role: "Football Writer" },
      { name: "Stuart Beckley", role: "Reporter" },
    ],
  },
];

/**
 * The press, per save nation id. Ids match the ones the save uses for a league's country and for a player's
 * nationality, so nothing has to be translated. A nation with no entry here gets the English pool and the
 * wire, which is the honest fallback for a career nobody wrote a specific pool for yet.
 */
const NATIONAL_PRESS: Record<number, readonly PressOutlet[]> = {
  14: [
    {
      key: "the-touchline",
      name: "The Touchline",
      house: "BROADSHEET",
      writers: [
        { name: "Marcus Bellweather", role: "Chief Football Writer" },
        { name: "Harriet Doyle", role: "Senior Sports Correspondent" },
        { name: "Owen Fairhurst", role: "Football Reporter" },
        { name: "Nadia Okonjo", role: "Columnist" },
      ],
    },
    {
      key: "final-whistle",
      name: "Final Whistle",
      house: "TABLOID",
      writers: [
        { name: "Danny Rourke", role: "Chief Sports Writer" },
        { name: "Kayleigh Frost", role: "Football Reporter" },
        { name: "Sonny Meade", role: "Transfer Correspondent" },
      ],
    },
    {
      key: "the-terrace",
      name: "The Terrace",
      house: "FAN",
      writers: [
        { name: "Jonah Pickersgill", role: "Club Correspondent" },
        { name: "Ruth Salter", role: "Feature Writer" },
      ],
    },
  ],
  45: [
    {
      key: "golazo",
      name: "Golazo",
      house: "TABLOID",
      writers: [
        { name: "Iker Salamanca", role: "Redactor Jefe" },
        { name: "Lucía Ferrán", role: "Corresponsal" },
        { name: "Bruno Alcaraz", role: "Cronista de Partido" },
      ],
    },
    {
      key: "diario-marcador",
      name: "Diario Marcador",
      house: "BROADSHEET",
      writers: [
        { name: "Nerea Portillo", role: "Jefa de Deportes" },
        { name: "Álvaro Mínguez", role: "Analista Táctico" },
      ],
    },
  ],
  21: [
    {
      key: "der-spieltag",
      name: "Der Spieltag",
      house: "BROADSHEET",
      writers: [
        { name: "Katrin Rohloff", role: "Fußballchefin" },
        { name: "Jonas Brenner", role: "Reporter" },
        { name: "Ines Kaltwasser", role: "Taktik-Kolumnistin" },
      ],
    },
    {
      key: "kurzpass",
      name: "Kurzpass",
      house: "ANALYTICS",
      writers: [
        { name: "Til Neudorf", role: "Datenredakteur" },
        { name: "Svenja Marbach", role: "Autorin" },
      ],
    },
  ],
  27: [
    {
      key: "calcio-oggi",
      name: "Calcio Oggi",
      house: "TABLOID",
      writers: [
        { name: "Enrico Balduzzi", role: "Caporedattore" },
        { name: "Marta Pisanelli", role: "Inviata" },
        { name: "Gianluca Ferretti", role: "Cronista" },
      ],
    },
    {
      key: "corriere-del-gol",
      name: "Corriere del Gol",
      house: "BROADSHEET",
      writers: [
        { name: "Paolo Nardini", role: "Editorialista" },
        { name: "Chiara Vergnano", role: "Analista" },
      ],
    },
  ],
  18: [
    {
      key: "le-vestiaire",
      name: "Le Vestiaire",
      house: "BROADSHEET",
      writers: [
        { name: "Camille Desnoyers", role: "Chef du Service Football" },
        { name: "Yann Kermorvant", role: "Envoyé Spécial" },
        { name: "Sofia Belaïd", role: "Chroniqueuse" },
      ],
    },
    {
      key: "but-hebdo",
      name: "But Hebdo",
      house: "TABLOID",
      writers: [
        { name: "Théo Marchand", role: "Rédacteur en Chef" },
        { name: "Amandine Rouxel", role: "Reporter" },
      ],
    },
  ],
  34: [
    {
      key: "de-kleedkamer",
      name: "De Kleedkamer",
      house: "BROADSHEET",
      writers: [
        { name: "Wouter van Basten", role: "Chef Voetbal" },
        { name: "Lieke Doornbos", role: "Verslaggever" },
        { name: "Sander Bakhuis", role: "Analist" },
      ],
    },
    {
      key: "veldwerk",
      name: "Veldwerk",
      house: "ANALYTICS",
      writers: [
        { name: "Nienke Roodenburg", role: "Data-analyse" },
        { name: "Joris van Weelden", role: "Auteur" },
      ],
    },
  ],
  38: [
    {
      key: "bola-hoje",
      name: "Bola Hoje",
      house: "TABLOID",
      writers: [
        { name: "Rui Fontelas", role: "Diretor Desportivo" },
        { name: "Inês Arruada", role: "Repórter" },
        { name: "Miguel Bettencourt", role: "Cronista" },
      ],
    },
  ],
  13: [
    {
      key: "superliga-nyt",
      name: "Superliga Nyt",
      house: "BROADSHEET",
      writers: [
        { name: "Mette Brøndum", role: "Fodboldchef" },
        { name: "Kasper Toft", role: "Reporter" },
        { name: "Ida Hollænder", role: "Kronikør" },
      ],
    },
    {
      key: "straffe",
      name: "Straffe",
      house: "TABLOID",
      writers: [
        { name: "Nikolaj Vestergaard", role: "Redaktør" },
        { name: "Freja Løvendal", role: "Journalist" },
      ],
    },
  ],
  7: [
    {
      key: "voetbal-krant",
      name: "Voetbal Krant",
      house: "BROADSHEET",
      writers: [
        { name: "Bram Dhondt", role: "Chef Sport" },
        { name: "Céline Verhaeghe", role: "Verslaggever" },
      ],
    },
  ],
  48: [
    {
      key: "saha-gazetesi",
      name: "Saha Gazetesi",
      house: "TABLOID",
      writers: [
        { name: "Emre Doğancan", role: "Spor Müdürü" },
        { name: "Selin Aybar", role: "Muhabir" },
        { name: "Kerem Tunçel", role: "Yazar" },
      ],
    },
  ],
  42: [
    {
      key: "the-hampden-post",
      name: "The Hampden Post",
      house: "BROADSHEET",
      writers: [
        { name: "Angus Kilbride", role: "Football Editor" },
        { name: "Morag Sinclair", role: "Chief Reporter" },
      ],
    },
  ],
  95: [
    {
      key: "the-soccer-ledger",
      name: "The Soccer Ledger",
      house: "BROADSHEET",
      writers: [
        { name: "Chuck Beaudine", role: "Soccer Editor" },
        { name: "Renée Calloway", role: "Staff Writer" },
        { name: "Marty Schoenfeld", role: "Columnist" },
      ],
    },
    {
      key: "pitchside-usa",
      name: "Pitchside",
      house: "FAN",
      writers: [
        { name: "Devon Marsh", role: "Club Reporter" },
        { name: "Alina Ocampo", role: "Feature Writer" },
      ],
    },
  ],
  52: [
    {
      key: "el-marcador",
      name: "El Marcador",
      house: "TABLOID",
      writers: [
        { name: "Santiago Ferreyra", role: "Jefe de Deportes" },
        { name: "Valentina Musso", role: "Cronista" },
      ],
    },
  ],
  54: [
    {
      key: "futebol-hoje",
      name: "Futebol Hoje",
      house: "TABLOID",
      writers: [
        { name: "Caio Rosemberg", role: "Editor de Esportes" },
        { name: "Bianca Tomazini", role: "Repórter" },
      ],
    },
  ],
  350: [
    {
      key: "riyadh-sport",
      name: "Riyadh Sport",
      house: "BROADSHEET",
      writers: [
        { name: "Faisal Al-Harbi", role: "Sport Editor" },
        { name: "Layla Nassar", role: "Correspondent" },
      ],
    },
  ],
  155: [
    {
      key: "asia-football-wire",
      name: "Asia Football Wire",
      house: "WIRE",
      writers: [
        { name: "Chen Ruolin", role: "Football Correspondent" },
        { name: "Hana Kobayashi", role: "Reporter" },
      ],
    },
  ],
};

export interface PressByline {
  outlet: string;
  writer: string;
  writerRole: string;
  /** The filing line: WIGAN, from the club's own name. */
  dateline: string;
  /** The outlet's own line on the club, which is what an opinion piece is written in. */
  stance: OutletStance;
}

function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value;
}

/** The pool a career's stories are filed with: its own nation's press first, then the wire, then English. */
export function pressPackFor(countryId: number | null): readonly PressOutlet[] {
  const national = countryId === null ? [] : (NATIONAL_PRESS[countryId] ?? []);
  return [...national, ...WIRE, ...ENGLISH];
}

/** The stance an outlet writes in: its own if it declares one, otherwise what its house implies. */
export function stanceOf(outlet: PressOutlet): OutletStance {
  return outlet.stance ?? houseStance(outlet.house);
}

/**
 * Who filed a story.
 *
 * The outlet is drawn from the career's own press pack, so a Danish career is read about in Danish football
 * papers rather than in invented English ones, and the writer comes from that outlet's own desk. Both are
 * chosen from the story's id, so the same story keeps the same byline however many times it is read.
 *
 * A story may ask for a STANCE, which is how an opinion piece is placed. The pool is then filtered to the
 * papers that write that way, and a career whose pack contains none of them falls back to the whole pack
 * rather than losing the piece: a straight report of something an angry columnist would have said is worse
 * than nothing, but not by much.
 */
export function bylineFor(
  seed: string,
  countryId: number | null,
  clubName: string,
  slot = "byline",
  stance?: OutletStance
): PressByline {
  const pack = pressPackFor(countryId);
  const wanted = stance ? pack.filter((outlet) => stanceOf(outlet) === stance) : [];
  const pool = wanted.length > 0 ? wanted : pack;
  const outlet = pool[hash(`${seed}|${slot}|outlet`) % pool.length];
  const writer = outlet.writers[hash(`${seed}|${slot}|writer`) % outlet.writers.length];
  return {
    outlet: outlet.name,
    writer: writer.name,
    writerRole: writer.role,
    dateline: datelineFor(clubName),
    stance: stanceOf(outlet),
  };
}

/** The club's own name as a filing line: "Wigan Athletic" files from WIGAN. */
export function datelineFor(clubName: string): string {
  const first = clubName.split(/[\s.]+/).filter(Boolean)[0] ?? clubName;
  return first.toUpperCase();
}

/** Every outlet on file, once each. Used by the checks. */
export function allOutlets(): readonly PressOutlet[] {
  const seen = new Map<string, PressOutlet>();
  for (const outlet of [...ENGLISH, ...WIRE, ...Object.values(NATIONAL_PRESS).flat()]) {
    if (!seen.has(outlet.key)) seen.set(outlet.key, outlet);
  }
  return [...seen.values()];
}
