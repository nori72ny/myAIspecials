import type { RequestHandler } from "express";

export const originChatBoundaryGuard: RequestHandler = (_req, res) => {
  return res.status(500).json({
    code: "ORIGIN_CHAT_BOUNDARY_NOT_HANDLED",
    message: "ORIGINの安全なチャット境界でリクエストを処理できなかったため、旧経路への移行を停止しました。",
    retryable: false,
    requestId: "UNKNOWN",
  });
};
