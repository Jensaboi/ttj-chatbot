import { PDFParse } from "pdf-parse";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { openai, supabase } from "./config.js";

export async function extractTextFromPdfs(urls = []) {
  try {
    if (!Array.isArray(urls)) throw new Error("Urls must be typeof array.");
    if (urls.length === 0) throw new Error("Urls is empty.");

    const parsers = urls.map(obj => ({
      parse: new PDFParse({ url: obj.url }),
      startPage: obj.startPage,
      name: obj.name,
    }));

    const parsedPdfs = await Promise.all(
      parsers.map(async pdf => {
        const { pages } = await pdf.parse.getText();

        let startPage = pdf?.startPage ?? 0;

        const text = pages
          .filter(page => page.num >= startPage)
          .map(page => page.text)
          .join(" ");

        return { text, name: pdf.name ?? "" };
      }),
    );

    return parsedPdfs;
  } catch (err) {
    console.error(err);
    throw new Error("Failed to extract text from pdf file: " + err.message, {
      cause: err,
    });
  }
}

export async function chunkText(text) {
  try {
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 450,
      chunkOverlap: 100,
    });

    return splitter.splitText(text);
  } catch (err) {
    console.error(err);
    throw new Error("Failed to chunk text: " + err.message, { cause: err });
  }
}

export async function createEmbeddings(chunks) {
  try {
    const embeddings = await Promise.all(
      chunks.map(async chunk => {
        const response = await openai.embeddings.create({
          input: chunk,
          model: process.env.OPENAI_EMBEDDING_MODEL,
        });

        return { content: chunk, embedding: response.data[0].embedding };
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
    const pdfs = await extractTextFromPdfs([
      "https://bransch.trafikverket.se/contentassets/18aa4c18f60e48c398afa22e65079111/01-termer.pdf",
      "https://bransch.trafikverket.se/contentassets/18aa4c18f60e48c398afa22e65079111/08hm-tagfard---system-h-och-m.pdf",
      "https://bransch.trafikverket.se/contentassets/18aa4c18f60e48c398afa22e65079111/10hms-vaxling--system-h-m-och-s.pdf",
      "https://bransch.trafikverket.se/contentassets/18aa4c18f60e48c398afa22e65079111/04-dialog-och-ordergivning_.pdf",
      "https://bransch.trafikverket.se/contentassets/18aa4c18f60e48c398afa22e65079111/03hms-signaler---system-h-m-och-s.pdf",
      "https://bransch.trafikverket.se/contentassets/18aa4c18f60e48c398afa22e65079111/03-signaler---gemensamma-regler_.pdf",
      "https://bransch.trafikverket.se/contentassets/18aa4c18f60e48c398afa22e65079111/06-fara-och-olycka.pdf",
    ]);
    console.log("Text extracted from pdfs successfully! ✅");

    const chunks = await chunkText(text);
    console.log("Text chunked successfully! ✅");

    const embeddings = await createEmbeddings(chunks);
    console.log("Embeddings created successfully! ✅");

    await supabase.from("embeddings").insert(embeddings);
    console.log("Embeddings inserted to vector db successfully! ✅");
  } catch (err) {
    console.log("Failed to seed vector db! 🚫");
    console.error(err);
  }
}

//seedVectorDb();

const modules = await extractTextFromPdfs([
  {
    url: "https://bransch.trafikverket.se/contentassets/18aa4c18f60e48c398afa22e65079111/08hm-tagfard---system-h-och-m.pdf",
    startPage: 5,
    name: "8HM Tågfärd - System H och M",
  },
]);

function prettifyModulesText(modules = []) {
  return modules.map(module => {
    var regex = new RegExp("\\s" + "\d+" + module.name + "\\s", "g");

    return { ...module, text: module.text.replace(regex, "") };
  });
}

console.log(prettifyModulesText(modules));
