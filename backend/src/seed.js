import { PDFParse } from "pdf-parse";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { openai, supabase } from "./config.js";

//extract text from pdfs
export async function getTextFromPdf({
  url,
  partial,
  startPage = 0,
  skipPage = [],
}) {
  try {
    if (!url) throw new Error("Url is required.");

    const parser = new PDFParse({ url });

    const { pages } = await parser.getText({ partial });

    if (!partial) pages.pop(); //remove last page, only if you didnt select one

    const text = pages
      .filter(page => page.num >= startPage)
      .filter(page => !skipPage.includes(page.num))
      .map(page => page.text)
      .join("\n")
      .replace(/-\n/g, "");

    return { text };
  } catch (err) {
    console.error(err);
    throw new Error("Failed to get text from pdf: " + err.message, {
      cause: err,
    });
  }
}

//parse the given pdf text into sections and remove noise
function parseTextToSection(text) {
  const pageAndModulRegex = /^\d+\t\d{1,}[A-ZÅÄÖa-zåäö”" ,-–]+\n/gm;
  const headingRegex = /^(\d(?:\.\d\d?)?)\s{1,}\t?([A-ZÅÄÖa-zåäö”" ,-]+\n)/gm;

  const pageMatches = [...text.matchAll(pageAndModulRegex)];
  const headingMatches = [...text.matchAll(headingRegex)];

  let chapter = "";
  let chapterNumber = "";

  const sections = headingMatches.map((item, i) => {
    const match = item[0];
    const startIndex = item.index + match?.length;
    const nextMatch = headingMatches[i + 1];
    let endIndex = nextMatch?.index;

    if (headingMatches.length - 1 === i) endIndex = text.length;

    let pageAndModule =
      pageMatches.find(page => page.index >= startIndex)?.[0] ??
      pageMatches[pageMatches.length - 1][0];

    const cleanedMatch = pageAndModule.replace(/\d+\t/, "").replace(/\n/, "");

    let [module, system] = cleanedMatch.split(/[–-]/);

    module = module?.trim() ?? "";
    system = system?.trim() ?? "";

    const [moduleNumber, operation] = module.split(" ") ?? ["", ""];

    const heading = match.replace(/\t/, "").replace(/\n/, "");

    let sectionNumber = heading.match(/^\d+(\.\d+)?/)?.[0];
    let section = heading.replace(sectionNumber, "")?.trim();
    sectionNumber = parseFloat(sectionNumber);

    if (Number.isInteger(sectionNumber)) {
      chapter = section;
      chapterNumber = sectionNumber;

      sectionNumber = null;
      section = null;
    }

    let content = text
      .slice(startIndex, endIndex)
      .replace(pageAndModulRegex, "")
      .replace(/\n/g, " ")
      .replace(/•/g, "\n•")
      .trim();

    return {
      module,
      moduleNumber,
      operation,
      system,
      chapter,
      chapterNumber,
      section,
      sectionNumber,
      content,
    };
  });

  return sections;
}

//Use recursive text splitter to split sections into chunks with overlap
async function chunkSections(sections) {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
  });
  const result = await Promise.all(
    sections.map(async section => {
      const texts = await splitter.splitText(section.content);

      const chunks = texts
        .map(chunk => ({
          module: section.module,
          moduleNumber: section.moduleNumber,
          operation: section.operation,
          system: section.system,
          sectionNumber: section.sectionNumber,
          section: section.section,
          chapter: section.chapter,
          chapterNumber: section.chapterNumber,
          chunk,
        }))
        .filter(item => item.chunk !== null && item.chunk !== undefined)
        .filter(item => item.chunk.length > 20);

      return [...chunks];
    }),
  );

  return result.flat();
}

export function parseTerms(sections) {
  const sectionTerms = sections.map(section => {
    const termsRegex = /\t/gm;

    const matches = [...section.content.matchAll(termsRegex)];

    let nextItemTerm = "";

    const terms = matches
      .map((item, i) => {
        const index = item.index;
        const startIndex = index + item[0].length;
        const input = item.input;
        const nextMatchIndex = matches[i + 1]?.index ?? input.length;

        let term;
        if (i === 0) {
          term = input.slice(0, index);
        } else {
          term = nextItemTerm.trim();
        }
        const stringToNextMatch = input.slice(startIndex, nextMatchIndex);
        const strArr = stringToNextMatch.split(".");

        nextItemTerm = strArr.pop();

        const answer = strArr.join(".").trim("");

        return {
          ...section,
          content: null,
          chunk: `Med ${term} menas: ${answer}`,
        };
      })
      .filter(item => item.answer !== "")
      .filter(item => item.term !== "");

    return terms;
  });

  return sectionTerms.flat();
}

export async function createEmbeddings(chunks) {
  try {
    const embeddings = await Promise.all(
      chunks.map(async chunk => {
        const response = await openai.embeddings.create({
          input: chunk.chunk,
          model: process.env.OPENAI_EMBEDDING_MODEL,
        });

        return {
          module: chunk.module,
          module_number: chunk.moduleNumber,
          operation: chunk.operation,
          system: chunk.system,
          section_number: chunk.sectionNumber,
          section: chunk.section,
          chapter: chunk.chapter,
          chapter_number: chunk.chapterNumber,
          chunk: chunk.chunk,
          embedding: response.data[0].embedding,
        };
      }),
    );

    return embeddings;
  } catch (err) {
    throw new Error("Failed to create embeddings: " + err.message, {
      cause: err,
    });
  }
}

async function seedVectorDb() {
  try {
    const urls = [
      {
        url: "https://bransch.trafikverket.se/contentassets/18aa4c18f60e48c398afa22e65079111/08hm-tagfard---system-h-och-m.pdf",
        startPage: 5,
      },
      {
        url: "https://bransch.trafikverket.se/contentassets/18aa4c18f60e48c398afa22e65079111/10hms-vaxling--system-h-m-och-s.pdf",
        startPage: 5,
        skipPage: [37, 38, 39, 40],
      },
      {
        url: "https://bransch.trafikverket.se/contentassets/18aa4c18f60e48c398afa22e65079111/04-dialog-och-ordergivning_.pdf",
        startPage: 5,
        skipPage: [29],
      },
      {
        url: "https://bransch.trafikverket.se/contentassets/18aa4c18f60e48c398afa22e65079111/11-broms.pdf",
        startPage: 5,
      },
      {
        url: "https://bransch.trafikverket.se/contentassets/18aa4c18f60e48c398afa22e65079111/06-fara-och-olycka.pdf",
        startPage: 5,
      },
      {
        url: "https://bransch.trafikverket.se/contentassets/18aa4c18f60e48c398afa22e65079111/09hms-sparrfard---system-h-m-och-s.pdf",
        startPage: 5,
      },
      {
        url: "https://bransch.trafikverket.se/contentassets/18aa4c18f60e48c398afa22e65079111/07-vagvakt.pdf",
        startPage: 5,
      },
    ];

    const modulesText = await Promise.all(
      urls.map(async url => getTextFromPdf(url)),
    );
    console.log("Text extracted from pdfs successfully! ✅");

    let sections = modulesText.map(module => parseTextToSection(module.text));
    console.log("Prased and generated pdf sections successfully! ✅");

    sections = sections.flat();

    const chunks = await chunkSections(sections);
    console.log("Text chunked successfully! ✅");

    const termsText = await getTextFromPdf({
      url: "https://bransch.trafikverket.se/contentassets/18aa4c18f60e48c398afa22e65079111/01-termer.pdf",
      startPage: 6,
      skipPage: [36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47],
    });
    console.log("Get text from terms pdf successfully! ✅");

    const termsSections = parseTextToSection(termsText.text);
    console.log("Parsed terms to sections successfully! ✅");

    const terms = parseTerms(termsSections);
    console.log("Terms parsed successfully! ✅");

    chunks.push(...terms);

    const embeddings = await createEmbeddings(chunks);
    console.log("Embeddings created successfully! ✅");

    await supabase.from("embeddings").insert(embeddings);
    console.log("Embeddings inserted to vector db successfully! ✅");

    console.log("Script ran successfully! ✅");
  } catch (err) {
    console.log("Failed to seed vector db! 🚫");
    console.log(err.message);
    console.error(err);
  }
}

await seedVectorDb();
/* 
const termsText = await getTextFromPdf({
  url: "https://bransch.trafikverket.se/contentassets/18aa4c18f60e48c398afa22e65079111/01-termer.pdf",
  startPage: 6,
  skipPage: [36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47],
});

const termsSections = parseTextToSection(termsText.text);

const terms = parseTerms(termsSections);
console.log(terms); */
