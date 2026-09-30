import { twelveData } from "./twelvedata";
import type { StockDataProvider } from "./types";

export const stockProvider: StockDataProvider = twelveData;
export type { Quote, StockDataProvider } from "./types";
