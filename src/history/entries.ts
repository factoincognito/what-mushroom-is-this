/**
 * The version history's entries (docs/SPEC.md 3.10, items 4 and 10): what each version of the app
 * brought, written for its users in the app's three languages, newest first. The list is built
 * into the app; nothing of it is read from the network, a file or the store when the app runs. It
 * is not `CHANGELOG.md`, which is the developers' record. It renders nothing.
 *
 * To add a version: put its entry first in `HISTORY`, in the PR that sets the version in
 * app.json, with the day of that commit as its date and its lines in the three languages, line
 * for line; and name the version in both lists of `ENTRIES_NOT_CHECKED_BY_A_SPEAKER`. A line says
 * in plain words what the user can now do or what has changed for them: no PR or backlog number,
 * and no name from the code. The tests beside this file check the list.
 */

import type { Language } from "../i18n/languages";

/** One version's entry. */
export type HistoryEntry = {
  /** The version, as `src/history/version.ts` reads one: `0.2.1`. */
  readonly version: string;
  /** The entry's date, a calendar day written `YYYY-MM-DD`. It stays when the text is corrected. */
  readonly date: string;
  /** The entry's lines in each language: the same number in the three, line for line. */
  readonly lines: { readonly [L in Language]: readonly string[] };
};

/**
 * The entries, newest first. The first is the entry of app.json's version. The entries of 0.2.0
 * and 0.1.0 are of the versions from before the history that were installed on a phone, written
 * from `CHANGELOG.md` and the specification; each one's date is the day its version was set in
 * app.json.
 */
export const HISTORY: readonly HistoryEntry[] = [
  {
    version: "0.2.1",
    date: "2026-11-16",
    lines: {
      en: [
        "The Settings link at the bottom of the Library is no longer hidden behind Android's navigation buttons. Every screen now keeps clear of the phone's navigation bar and its display cutout.",
        "The app now removes camera data and other metadata from the copy of a photo that it sends for analysis. Before, a photo whose copy held such data, for example a camera photo picked from the gallery, was not analysed.",
        "After a photo is removed from a find whose analysis failed, the reason shown no longer names a photo by its number, as the photos left may have other numbers.",
      ],
      sv: [
        "Länken Inställningar längst ner i Biblioteket döljs inte längre bakom Androids navigeringsknappar. Inget på någon sida hamnar nu bakom telefonens navigeringsfält eller skärmutskärningen.",
        "Appen tar nu bort kameradata och andra metadata ur den kopia av ett foto som den skickar för analys. Tidigare analyserades inte ett foto vars kopia innehöll sådana data, till exempel ett kamerafoto som valts i galleriet.",
        "När ett foto har tagits bort ur ett fynd vars analys misslyckades nämner orsaken som visas inte längre något foto med nummer, eftersom de foton som är kvar kan ha fått andra nummer.",
      ],
      it: [
        "Il link Impostazioni in fondo alla Biblioteca non è più nascosto dietro i pulsanti di navigazione di Android. Ora in nessuna pagina qualcosa finisce dietro la barra di navigazione del telefono o il ritaglio del display.",
        "Ora l'app rimuove i dati della fotocamera e gli altri metadati dalla copia di una foto che invia per l'analisi. Prima una foto la cui copia conteneva questi dati, ad esempio una foto della fotocamera scelta dalla galleria, non veniva analizzata.",
        "Dopo la rimozione di una foto da un ritrovamento la cui analisi non è riuscita, il motivo mostrato non indica più una foto con il suo numero, perché le foto rimaste possono avere numeri diversi.",
      ],
    },
  },
  {
    version: "0.2.0",
    date: "2026-11-11",
    lines: {
      en: [
        "Describe a mushroom in words, without a photo. The answer shows a picture of the species from Wikimedia Commons, and the edibility only once a check against that picture agrees.",
        "A find can hold up to 5 photos, and photos can also be picked from the phone's files.",
        "A lookup can be made without saving it: with Save off, nothing of it is kept.",
        "The Library is the new start screen: your finds in a list or on a map, with filters for species, year and month.",
        "The confidence is now a number from 1 to 100. Below 70, the edibility is shown as unknown.",
        "The app is now called Wushroom.",
      ],
      sv: [
        "Beskriv en svamp med ord, utan foto. Svaret visar en bild av arten från Wikimedia Commons, och ätligheten först när en kontroll mot den bilden bekräftar matchningen.",
        "Ett fynd kan ha upp till 5 foton, och foton kan också väljas bland telefonens filer.",
        "En sökning kan göras utan att sparas: när Spara är av sparas inget av den.",
        "Biblioteket är den nya startsidan: dina fynd i en lista eller på en karta, med filter för art, år och månad.",
        "Säkerheten anges nu som ett tal från 1 till 100. Under 70 visas ätligheten som okänd.",
        "Appen heter nu Wushroom.",
      ],
      it: [
        "Descrivi un fungo a parole, senza foto. La risposta mostra un'immagine della specie da Wikimedia Commons, e la commestibilità solo quando un controllo su quell'immagine conferma la corrispondenza.",
        "Un ritrovamento può avere fino a 5 foto, e le foto si possono scegliere anche dai file del telefono.",
        "Una ricerca si può fare senza salvarla: con Salva disattivato, non ne viene conservato nulla.",
        "La Biblioteca è la nuova pagina iniziale: i tuoi ritrovamenti in un elenco o su una mappa, con filtri per specie, anno e mese.",
        "La sicurezza è ora un numero da 1 a 100. Sotto 70, la commestibilità è indicata come sconosciuta.",
        "Ora l'app si chiama Wushroom.",
      ],
    },
  },
  {
    version: "0.1.0",
    date: "2026-11-08",
    lines: {
      en: [
        "The first version. Take a photo of a mushroom, or pick one from the gallery, and get Claude's best assessment of the species: its names, its edibility, Claude's confidence and the poisonous look-alikes.",
        "Each find is kept in a log on the phone, with its photo, its time and its position.",
        "Without a network, finds wait and are analysed when the network is back.",
        "The analysis uses your own Claude API key, which you enter in Settings.",
        "The app is in English, Swedish and Italian.",
      ],
      sv: [
        "Den första versionen. Ta ett foto av en svamp, eller välj ett i galleriet, och få Claudes bästa bedömning av arten: dess namn, dess ätlighet, Claudes säkerhet och de giftiga förväxlingsarterna.",
        "Varje fynd sparas i en logg på telefonen, med foto, tid och position.",
        "Utan nätverk väntar fynden och analyseras när nätverket är tillbaka.",
        "Analysen använder din egen Claude-API-nyckel, som du anger i Inställningar.",
        "Appen finns på engelska, svenska och italienska.",
      ],
      it: [
        "La prima versione. Scatta una foto di un fungo, o scegline una dalla galleria, e ricevi la migliore valutazione di Claude sulla specie: i suoi nomi, la sua commestibilità, la sicurezza di Claude e le specie velenose simili.",
        "Ogni ritrovamento è conservato in un registro sul telefono, con la foto, la data e l'ora e la posizione.",
        "Senza rete, i ritrovamenti restano in attesa e vengono analizzati quando la rete torna.",
        "L'analisi usa la tua chiave API di Claude, che inserisci in Impostazioni.",
        "L'app è in inglese, svedese e italiano.",
      ],
    },
  },
];

/**
 * The entries whose Swedish or Italian text no speaker of the language has checked yet, by
 * version, as `NOT_CHECKED_BY_A_SPEAKER` records it for the app's strings (docs/SPEC.md 3.10,
 * item 10). A version leaves a list once that language's speaker has checked its entry. An entry
 * not checked is still shown in its language. The two lists are kept apart, as each language is
 * checked by its own speaker.
 */
export const ENTRIES_NOT_CHECKED_BY_A_SPEAKER: {
  readonly sv: readonly string[];
  readonly it: readonly string[];
} = {
  sv: ["0.2.1", "0.2.0", "0.1.0"],
  it: ["0.2.1", "0.2.0", "0.1.0"],
};

const DATE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;

/**
 * The instant at which a date written `YYYY-MM-DD` begins in UTC, in milliseconds; null for what
 * is not written so or is no real calendar date, as `2026-02-30` is not.
 */
function startOfDateInUtc(text: unknown): number | null {
  if (typeof text !== "string") {
    return null;
  }
  const match = DATE.exec(text);
  if (match === null) {
    return null;
  }
  // Set as a full year, so that the years 0 to 99 are not read as 1900 to 1999.
  const date = new Date(0);
  date.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  // A day the month does not have, or a month the year does not have, rolls over into a later
  // one, and the date is then no longer the one written.
  if (date.toISOString().slice(0, 10) !== text) {
    return null;
  }
  return date.getTime();
}

/** Whether a text is a real calendar date written `YYYY-MM-DD`. */
export function isCalendarDate(text: unknown): boolean {
  return startOfDateInUtc(text) !== null;
}

/**
 * An entry's date as the screen shows it (docs/SPEC.md 3.10, item 3): that calendar day whatever
 * the phone's time zone, in the language's form, the form a find's date has on the map
 * (`formatFindDate`, `src/library/mapPins.ts`); null for a date that is no calendar date.
 */
export function formatEntryDate(date: string, language: Language): string | null {
  const start = startOfDateInUtc(date);
  if (start === null) {
    return null;
  }
  // The day is read in UTC, where it was placed, and not in the phone's zone.
  return new Intl.DateTimeFormat(language, { dateStyle: "medium", timeZone: "UTC" }).format(start);
}
