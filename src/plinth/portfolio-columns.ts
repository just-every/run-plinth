import type { ReportColumn } from './report-field-model'

export const portfolioColumns: ReportColumn[] = [
 ['original_budget','Original cost budget','money'],['revised_budget','Revised cost budget','money'],
 ['committed','Committed cost','money'],['actual','Posted actual cost','money'],['forecast','Forecast final cost','money'],
 ['margin','Forecast margin','money'],['billed','Earned billings','money'],['collected','Collections','money'],['backlog','Unbilled sold revenue','money'],
 ['slippage','Maximum schedule slippage (minutes)','number'],['open_decisions','Open decisions','number'],
 ['as_of','Report as-of date (UTC)','date'],['forecast_stale','Forecast requires review','boolean'],
].map(([id,name,type])=>({id:'portfolio.'+id,name:name!,type:type as ReportColumn['type']}))

const historicalIds = new Set([...portfolioColumns.map(c => c.id), 'native.stage', 'native.delayed', 'native.contract'])
export const historicalPortfolioColumn = (id: string) => historicalIds.has(id)
