import { documents, isInteractiveDocument, isKustoFile, isNotebookCell } from './server';

type MacroMap = {[key: string]: boolean};

// Get the name and body of a macro declaration, if possible.
const matchMacro = (block: string): {name: string; block: string} | false => {
    if (block.startsWith("//!macro[")) {
        let name = block.split(/\[|\]/)[1];
        block = block.slice(block.search(/\r?\n/) + 1);
        return {name, block};
    }
    return false;
} 

// Scan through the whole document to search for the required macro.
// Returns the macro block or false.
const getMacroBlock = (macros: MacroMap): string | false => {
    let macroBlocks = {};
    for (const d of documents.all()){
        // ignore irrelevant blocks
        if (!d || isInteractiveDocument(d) || (!isNotebookCell(d) && !isKustoFile(d))) {
            continue;
        }

        // try to match this block with the macro name.
        const macroResult = matchMacro(d.getText());
        if (macroResult !== false && macros[macroResult.name]) {
            macroBlocks[macroResult.name] = macroResult.block;
        }
    }

    // Construct the macro block. Also, verify all imports worked; if not, do something bad.
    let macroBlock = "";
    for (const m in macros) {
        if (macroBlocks[m]) {
            macroBlock += macroBlocks[m] + "\n";
            continue;
        } else {
            // TODO: do something bad.
            // return false;
        }
    }

    return macroBlock;
}

// Get all imported macros from kusto query block.
const getMacroImports = (block: string): MacroMap => {
    let macros = {};
    for (let line of block.split(/\r?\n/)) {
        if (line.startsWith('//!import[')) {
            var key = line.split(/\[|\]/)[1];
            macros[key] = true;
        }
    }
    return macros;
}

// Prepend block with "macro expansions" if required.
export const macroFix = (block: string): { fixedBlock: string, lineOffset: number, characterOffset: number } => {
    const macros = getMacroImports(block);
    let lineOffset = 0;
    let characterOffset = 0;
    if (Object.keys(macros).length > 0) {
        const macroBlock = getMacroBlock(macros);
        if (macroBlock) {
            block = macroBlock + block;
            
            // The macro block will mess with the position for autocomplete, hover, etc, so lets fix it.
            const lines = macroBlock.split(/\r?\n/);
            lineOffset = lines.length - 1 < 0 ? 0 : lines.length - 1;
            characterOffset = macroBlock.length;
        } else {
            // TODO: macro import not found. Do something bad. 
        }
    }
    return { fixedBlock: block, lineOffset, characterOffset};
}
