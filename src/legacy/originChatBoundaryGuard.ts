import type { RequestHandler } from "express";

export const originChatBoundaryGuard: RequestHandler = (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      code: "METHOD_NOT_ALLOWED",
      message: "指定されたHTTPメソッドは許可されていません。",
      retryable: false,
      requestId: "UNKNOWN",
    });
  }

  return res.status(500).json({
    code: "ORIGIN_CHAT_BOUNDARY_NOT_HANDLED",
    message: "ORIGINの安全なチャット境界でリクエストを処理できなかったため、旧経路への移行を停止しました。",
    retryable: false,
    requestId: "UNKNOWN",
  });
};
