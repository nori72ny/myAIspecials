import React, { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Activity,
  Brain,
  FolderKanban,
  LayoutDashboard,
  Menu,
  MessageSquare,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "../../utils";
import { useAppState } from "../../hooks/useAppState";
import PersonalDashboard from "./PersonalDashboard";
import PersonalMemory from "./PersonalMemory";
import ProjectWorkspace from "./ProjectWorkspace";
import UnifiedChat from "./UnifiedChat";

type ViewState = "dashboard" | "chat" | "workspace" | "memory";
type AiCoreState =
  | "UNKNOWN"
  | "CONNECTING"
  | "HEALTHY"
  | "DEGRADED"
  | "OFFLINE"