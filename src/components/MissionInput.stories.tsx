import React from "react";
import MissionInput from "./MissionInput";

export default {
  title: "Components/MissionInput",
  component: MissionInput,
  tags: ["autodocs"],
  argTypes: {
    onSubmit: { action: "submitted" },
    initialValue: { control: "text" },
    placeholder: { control: "text" },
  },
};

export const Default = {
  render: (args: any) => <MissionInput {...args} />,
  args: {
    placeholder: "ミッションを詳細に入力してください...",
  },
};

export const Prepopulated = {
  render: (args: any) => <MissionInput {...args} />,
  args: {
    initialValue: "マイクロサービス構成のシステム設計とイベント駆動メッセージ設計書を策定してください。",
  },
};

export const CustomPlaceholder = {
  render: (args: any) => <MissionInput {...args} />,
  args: {
    placeholder: "例：東京のおすすめ観光ルートを3パターン作成して...",
  },
};
