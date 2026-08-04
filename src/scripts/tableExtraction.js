import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString();

export const extractQuoteFromPDF = async (pdfData) => {
  const file = pdfData.get("pdf");
  if (!file) throw new Error("No file found in FormData");

  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdfDocument = await loadingTask.promise;

  const processedPages = await processPDFData(pdfDocument);
  return processedPages;
};

const processPDFData = async (data) => {
  const extractPageText = (pageTextItems) => {
    const rowsY = {};

    for (let i = 0; i < pageTextItems.length; i++) {
      const currentText = pageTextItems[i];
      if (!currentText.str || !currentText.str.trim()) continue;

      const transform = currentText.transform;
      const x = transform[4];
      const y = transform[5];

      // Rounding Y to group characters on the same line
      const rowKey = Math.round(y);

      if (!rowsY[rowKey]) {
        rowsY[rowKey] = [];
      }

      rowsY[rowKey].push({
        text: currentText.str,
        x,
        y
      });
    }

    // Sort items within each row horizontally (Left to Right)
    for (const y in rowsY) {
      rowsY[y].sort((a, b) => a.x - b.x);
    }

    // Sort rows vertically (Top to Bottom: Descending Y)
    const sortedRows = Object.keys(rowsY)
      .map(Number)
      .sort((a, b) => b - a)
      .map((y) => ({
        y,
        items: rowsY[y]
      }));

    return sortedRows;
  };

  const extractPageTable = (pageRows) => {
    const assembleLine = (items) => {
      let line = "";
      for (let i = 0; i < items.length; i++) {
        line += `${items[i].text} `;
      }
      return line.replace(/\s+/g, " ").trim();
    };

    const convertLineToObject = (line) => {
      const regex = /^(\d+)\s+(\d+)\s+([-\w]+)\s+(.+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)$/;
      const match = line.match(regex);

      if (!match) return null;

      const middleText = match[4].trim();
      const lastSpaceIndex = middleText.lastIndexOf(" ");
      
      // Handle cases where PartDescription or Bin might missing a space
      const partDescription = lastSpaceIndex !== -1 ? middleText.substring(0, lastSpaceIndex) : middleText;
      const bin = lastSpaceIndex !== -1 ? middleText.substring(lastSpaceIndex + 1) : "";

      return {
        ShipQty: Number(match[1]),
        BOQty: Number(match[2]),
        PartNumber: match[3],
        PartDescription: partDescription,
        Bin: bin,
        List: parseFloat(match[5]).toFixed(2),
        Net: parseFloat(match[6]).toFixed(2),
        Amount: parseFloat(match[7]).toFixed(2)
      };
    };

    let store = false;
    let table = [];

    for (let i = 0; i < pageRows.length; i++) {
      const currentRow = pageRows[i];
      const { items } = currentRow;

      const line = assembleLine(items);

      if (line === "SHIP QTY B. O. QTY PART NUMBER / DESCRIPTION BIN LIST NET AMOUNT") {
        store = true;
        continue;
      } else if (line.includes("SUBTOTAL") || (!line.replace(/[0-9.]/g, "").trim() && line.length > 0)) {
        if (store) break; // Stop reading this page's table
      }

      if (!store) continue;

      const convertedLine = convertLineToObject(line);
      // Filter out nulls so we only push valid parsed rows!
      if (convertedLine) {
        table.push(convertedLine);
      }
    }

    return table;
  };

  const convertTextFromPages = async (pdfDoc) => {
    let combinedTable = [];
    const pageCount = pdfDoc.numPages;

    for (let i = 1; i <= pageCount; i++) {
      const page = await pdfDoc.getPage(i);
      const textContent = await page.getTextContent();

      const pageRows = extractPageText(textContent.items);
      const pageTable = extractPageTable(pageRows);
      
      if (pageTable && pageTable.length > 0) {
        combinedTable.push(...pageTable);
      }
    }

    return combinedTable;
  };

  return await convertTextFromPages(data);
};
