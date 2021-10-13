import { KustoResponseDataSet } from 'azure-kusto-data/source/response';
import {
    notebooks,
    CancellationToken,
    ExtensionContext,
    NotebookCell,
    NotebookCellStatusBarAlignment,
    NotebookCellStatusBarItemProvider
} from 'vscode';
import { getFromCache } from '../cache';
import { GlobalMementoKeys } from '../constants';
import { IConnectionInfo , AzureAuthenticatedConnectionInfo} from '../kusto/connections/types';

export class StatusBarProvider implements NotebookCellStatusBarItemProvider {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    protected contructor() {}
    static register(context: ExtensionContext) {
        const statusBarProvider = new StatusBarProvider();
        context.subscriptions.push(
            notebooks.registerNotebookCellStatusBarItemProvider('kusto-notebook', statusBarProvider),
            notebooks.registerNotebookCellStatusBarItemProvider('kusto-interactive', statusBarProvider)
        );
    }

    private getConnectionText(connectionInfo?: IConnectionInfo): string{
        if (connectionInfo != undefined && connectionInfo.type != 'appInsights'){
            let azAuthConnectionInfo = <AzureAuthenticatedConnectionInfo>connectionInfo;
            return  " - server: " + azAuthConnectionInfo.displayName + " database: " + azAuthConnectionInfo.database;
        }
        return "";
    }

    provideCellStatusBarItems(cell: NotebookCell, _token: CancellationToken) {
        if (cell.outputs.length) {
            const firstOutput = cell.outputs[0];
            if (firstOutput.items.length) {
                const outputItem = firstOutput.items[0];
                try {
                    const results: KustoResponseDataSet = JSON.parse(new TextDecoder().decode(outputItem.data));
                    const rowCount = results?.primaryResults.length
                        ? results?.primaryResults[0]._rows.length
                        : undefined;

                        let connection = getFromCache<IConnectionInfo>(GlobalMementoKeys.lastUsedConnection);

                    if (rowCount) {
                        return [
                            {
                                text: `${rowCount} records${this.getConnectionText(connection)}`,
                                alignment: NotebookCellStatusBarAlignment.Left
                            }
                        ];
                    }
                } catch (ex) {
                    console.error('Failures in statusbar', ex);
                }
            }
        }
        return [];
    }
}
