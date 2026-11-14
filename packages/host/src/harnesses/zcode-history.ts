import { NATIVE_HISTORY_LIMIT } from "./native-history.js";
import type { Wire } from "./adapter.js";

/** Fetch one coherent native projection; never publish a silently truncated transcript. */
export async function readZCodeHistory(
  request: (params: Wire) => Promise<Wire>,
): Promise<Wire & { rows: Wire[]; hasMore: boolean }> {
  const pages: Wire[][] = [];
  let beforeRowId: number | undefined;
  let first: Wire | undefined;
  let size = 0;
  for (let page = 0; page < 100; page++) {
    const result = await request({
      limit: 200,
      ...(beforeRowId === undefined ? {} : { beforeRowId }),
    });
    if (
      !Array.isArray(result.rows) ||
      result.rows.length > 200 ||
      typeof result.hasMore !== "boolean" ||
      typeof result.atLogEpoch !== "string" ||
      !Number.isSafeInteger(result.atRevision) ||
      !Number.isSafeInteger(result.atSeq)
    )
      throw new Error("ZCode 历史分页响应无效。");
    first ??= result;
    if (
      result.atLogEpoch !== first.atLogEpoch ||
      result.atRevision !== first.atRevision ||
      result.atSeq !== first.atSeq
    )
      throw new Error("ZCode 历史读取期间发生变化，请重新读取；未拼接不同版本。");
    let previous = -Infinity;
    for (const row of result.rows) {
      if (
        !row ||
        !Number.isSafeInteger(row.rowId) ||
        row.rowId <= previous ||
        (beforeRowId !== undefined && row.rowId >= beforeRowId)
      )
        throw new Error("ZCode 历史分页游标无效。");
      previous = row.rowId;
    }
    size += Buffer.byteLength(JSON.stringify(result.rows));
    if (size > NATIVE_HISTORY_LIMIT) throw new Error("ZCode 历史超过单次读取上限。");
    pages.push(result.rows);
    if (!result.hasMore) return { ...first, rows: pages.reverse().flat(), hasMore: false };
    if (!result.rows.length) throw new Error("ZCode 历史分页未推进游标。");
    beforeRowId = result.rows[0].rowId;
  }
  throw new Error("ZCode 历史超过 20000 行读取上限。");
}
