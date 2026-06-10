import React from 'react';
import * as Lucide from 'lucide-react';
import { helia } from './heliaTheme';

export const Activity = Lucide.Activity;
export const AlertTriangle = Lucide.AlertTriangle;
export const Bell = Lucide.Bell;
export const BookOpen = Lucide.BookOpen;
export const Building2 = Lucide.Building2;
export const Calendar = Lucide.Calendar;
export const ChevronDown = Lucide.ChevronDown;
export const ChevronLeft = Lucide.ChevronLeft;
export const ChevronRight = Lucide.ChevronRight;
export const ClipboardCheck = Lucide.ClipboardCheck;
export const ClipboardList = Lucide.ClipboardList;
export const FileText = Lucide.FileText;
export const Flag = Lucide.Flag;
export const HelpCircle = Lucide.HelpCircle;
export const Info = Lucide.Info;
export const LayoutDashboard = Lucide.LayoutDashboard;
export const Leaf = Lucide.Leaf;
export const LogOut = Lucide.LogOut;
export const MessageCircle = Lucide.MessageCircle;
export const Pill = Lucide.Pill;
export const Salad = Lucide.Salad;
export const ScrollText = Lucide.ScrollText;
export const Search = Lucide.Search;
export const Shield = Lucide.Shield;
export const ShieldCheck = Lucide.ShieldCheck;
export const Sparkles = Lucide.Sparkles;
export const Stethoscope = Lucide.Stethoscope;
export const Upload = Lucide.Upload;

export function HeliaIcon({ icon: Icon, size = 18, color = helia.sage, strokeWidth = 2, style }) {
  if (!Icon) return null;
  return <Icon size={size} color={color} strokeWidth={strokeWidth} aria-hidden style={style} />;
}

export function SeverityIcon({ severity, size = 14 }) {
  const s = String(severity || 'info').toLowerCase();
  if (s === 'alert' || s === 'warning') {
    return (
      <AlertTriangle
        size={size}
        color={s === 'alert' ? helia.alert : helia.warning}
        strokeWidth={2}
        aria-hidden
      />
    );
  }
  return <Info size={size} color={helia.sage} strokeWidth={2} aria-hidden />;
}

export function getScoreStatus(score) {
  if (score >= 70) return 'Excellent';
  if (score >= 40) return 'Good';
  return 'Getting Started';
}

export function getScoreStatusColor(score) {
  if (score >= 70) return helia.forest;
  if (score >= 40) return helia.sage;
  return helia.muted;
}

export const NAV_ICONS = {
  '/dashboard': LayoutDashboard,
  '/alerts': Bell,
  '/timeline': Calendar,
  '/narrative': ScrollText,
  '/documents': FileText,
  '/hospital': Building2,
  '/emergency-card': Shield,
  '/appointment-prep': ClipboardList,
  '/debrief': ClipboardCheck,
  '/second-opinion': Search,
  '/symptoms': Activity,
  '/medications': Pill,
  '/lifestyle': Salad,
};

export const LIFESTYLE_CATEGORY_ICONS = {
  nutrition: Salad,
  lifestyle: Leaf,
  supplement: Pill,
  activity: Activity,
};
