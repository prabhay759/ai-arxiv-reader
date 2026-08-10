export declare const FIELD: {
  TITLE: 1
  AUTHOR: 2
  CATEGORY: 4
  ABSTRACT: 8
}

export declare const FIELD_WEIGHT: Record<number, number>
export declare const ABSTRACT_STOPWORDS: Set<string>

export declare function fold(text: string): string
export declare function tokenize(
  text: string,
  options?: { stopwords?: Set<string> }
): string[]
export declare function shardKey(term: string, prefixLength: number): string
export declare function bm25Tf(
  tf: number,
  fieldLength: number,
  avgFieldLength: number,
  k1?: number,
  b?: number
): number
export declare function idf(docFreq: number, docCount: number): number

export declare const WEIGHT_SCALE: number
export declare const WEIGHT_CEILING: number
export declare function quantizeWeight(weight: number): number
export declare function dequantizeWeight(quantized: number): number
