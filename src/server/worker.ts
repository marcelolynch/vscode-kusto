import * as path from 'path';
import type { ILanguageServiceExport, LanguageService } from './kustoLanguageService';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const dynamicRequireToDisableWebPackBundling = eval(['r', 'e', 'q' + 'uire'].join(''));
const languageService: ILanguageServiceExport = dynamicRequireToDisableWebPackBundling(
    path.join(__dirname, '..', '..', 'libs', 'kusto', 'languageService', 'kustoLanguageService')
);
import {
    Diagnostic,
    CompletionList,
    FoldingRange,
    Hover,
    Position,
    Range,
    TextEdit,
    WorkspaceEdit
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { EngineSchema } from './schema';
import { getNotebookUri } from './utils';
import { macroFix } from './macro';

const languageServersPerEngineSchemaAndDefaultDb = new Map<string, LanguageService>();
const documentUriAndEngineSchemaAndDefaultDb = new Map<string, string>();
function getClusterDatabaseId(engineSchema: EngineSchema): string {
    return `${engineSchema.cluster.connectionString}:${engineSchema.database?.name}`;
}
function getLanguageServer(document: TextDocument): LanguageService {
    const uri = getNotebookUri(document);
    const id = documentUriAndEngineSchemaAndDefaultDb.get(uri.toString());
    return languageServersPerEngineSchemaAndDefaultDb.get(id || '') || languageService.getKustoLanguageService();
}
export async function setDocumentEngineSchema(uri: string, engineSchema: EngineSchema) {
    uri = getNotebookUri(uri).toString();
    const id = getClusterDatabaseId(engineSchema);
    documentUriAndEngineSchemaAndDefaultDb.set(uri, id);
    const oldLs = languageServersPerEngineSchemaAndDefaultDb.get(id);
    if (oldLs) {
        await oldLs.setSchema(engineSchema);
        return;
    }
    const newLs = languageService.createLanguageService(engineSchema);
    languageServersPerEngineSchemaAndDefaultDb.set(id, newLs);
}
function isJupyterNotebook(document: TextDocument) {
    if (document.uri.toLowerCase().includes('.knb') && !document.uri.toLowerCase().includes('.ipynb')) {
        return false;
    }
    const uri = getNotebookUri(document);
    return uri.fsPath.toLowerCase().endsWith('.ipynb');
}
function isAJupyterCellThatCanBeIgnored(document: TextDocument) {
    if (!isJupyterNotebook(document)) {
        return false;
    }
    if (document.lineCount > 1) {
        return false;
    }
    const text = document.getText();
    // Ignore some single line kql commands.
    if (
        text.startsWith('%kql') &&
        (text.includes('--version') || text.includes('--help') || text.toLowerCase().includes('azuredataexplorer'))
    ) {
        return true;
    }
    return false;
}
function fixJupyterNotebook(document: TextDocument): { document: TextDocument, lineOffset: number, characterOffset: number } {
    let text = document.getText();
    if (isJupyterNotebook(document)) {
        text = text.replace('%%kql', '//kql').replace('%kql ', '     ');
    }
    let { fixedBlock, lineOffset, characterOffset } = macroFix(text);
    return { document: TextDocument.create(document.uri.toString(), 'kusto', document.version, fixedBlock), lineOffset, characterOffset };
}

export async function getCompletions(document: TextDocument, position: Position): Promise<CompletionList> {
    const ls = getLanguageServer(document);
    if (isAJupyterCellThatCanBeIgnored(document)) {
        return { isIncomplete: false, items: [] };
    }
    let { document: newDocument} = fixJupyterNotebook(document);
    const completions = await ls.doComplete(newDocument, Position.create(position.line, position.character));
    return completions;
}
export async function getValidations(
    document: TextDocument,
    intervals: { start: number; end: number }[]
): Promise<Diagnostic[]> {
    const ls = getLanguageServer(document);
    if (isAJupyterCellThatCanBeIgnored(document)) {
        return [];
    }
    let { document: newDocument, lineOffset, characterOffset } = fixJupyterNotebook(document);
    intervals.forEach(i => {
        i.start += characterOffset;
        i.end += characterOffset;
    });
    const diagnostics = await ls.doValidation(newDocument, intervals);
    let fixedDiagnostics: Diagnostic[] = [];
    diagnostics.forEach(d => {
        if (d.range.start.line - lineOffset < 0) {
            // Skip this, it is happening in another cell.
            return;
        }
        d.range.start = Position.create(d.range.start.line - lineOffset, d.range.start.character);
        d.range.end = Position.create(d.range.end.line - lineOffset, d.range.end.character);
        fixedDiagnostics.push(d);
    });
    return fixedDiagnostics;
}
export async function doHover(document: TextDocument, position: Position): Promise<Hover | undefined> {
    const ls = getLanguageServer(document);
    let { document: newDocument, lineOffset} = fixJupyterNotebook(document);
    return ls.doHover(newDocument, Position.create(position.line + lineOffset, position.character));
}
export async function doDocumentFormat(document: TextDocument): Promise<TextEdit[]> {
    const ls = getLanguageServer(document);
    if (isAJupyterCellThatCanBeIgnored(document)) {
        return [];
    }
    return ls.doDocumentFormat(fixJupyterNotebook(document).document);
}
export async function doRangeFormat(document: TextDocument, range: Range): Promise<TextEdit[]> {
    const ls = getLanguageServer(document);
    if (isAJupyterCellThatCanBeIgnored(document)) {
        return [];
    }
    return ls.doRangeFormat(fixJupyterNotebook(document).document, range);
}
export async function doRename(
    document: TextDocument,
    position: Position,
    newName: string
): Promise<WorkspaceEdit | undefined> {
    const ls = getLanguageServer(document);
    if (isAJupyterCellThatCanBeIgnored(document)) {
        return;
    }
    let { document: newDocument, lineOffset } = fixJupyterNotebook(document);
    const edit = await ls.doRename(newDocument, Position.create(position.line + lineOffset, position.character), newName);
    return edit;
}
export async function doFolding(document: TextDocument): Promise<FoldingRange[]> {
    const ls = getLanguageServer(document);
    return ls.doFolding(fixJupyterNotebook(document).document);
}

export function disposeAllLanguageServers() {
    languageServersPerEngineSchemaAndDefaultDb.clear();
}
