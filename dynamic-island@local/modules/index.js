// Module registries. Which modules are shown, and in which order, comes from
// GSettings (center-modules, center-compact-modules, qs-modules).
//
// To add a module: create modules/<name>.js (default-export a class extending
// IslandModule from ./base.js), add it to a map below, then enable it with
// `di-config` (or `di-config set center-modules "['calendar','<name>']"`).
import ClockModule from './clock.js';
import SearchModule from './search.js';
import MusicModule from './music.js';
import CalendarModule from './calendar.js';
import NotificationListModule from './notificationList.js';
import CpuModule from './cpu.js';
import RamModule from './ram.js';
import TempModule from './temp.js';
import NetModule from './net.js';
import BatteryModule from './battery.js';

import QsStatusModule from './qs/status.js';
import SlidersModule from './qs/sliders.js';
import GpuModule from './stats/gpu.js';
import DiskModule from './stats/disk.js';
import GraphModule from './stats/graph.js';
import ProcsModule from './stats/procs.js';
import ClaudeUsageModule from './claude.js';
import WorkspacesModule from './stats/workspaces.js';
import AudioOutputModule from './qs/audio.js';
import TogglesModule from './qs/toggles.js';
import ClipboardModule from './qs/clipboard.js';
import SystemModule from './qs/system.js';

/** Always present, before the configurable ones. */
export const CENTER_FIXED = [ClockModule, SearchModule];
export const QS_FIXED = [QsStatusModule];
export const STATS_FIXED = [];

/** id -> class, selectable from settings. */
export const CENTER_MODULES = {
    music: MusicModule,
    calendar: CalendarModule,
    notifications: NotificationListModule,
    claude: ClaudeUsageModule,
};

/** The statistics island (top left). */
export const STATS_MODULES = {
    cpu: CpuModule,
    ram: RamModule,
    temp: TempModule,
    net: NetModule,
    battery: BatteryModule,
    gpu: GpuModule,
    disk: DiskModule,
    graph: GraphModule,
    procs: ProcsModule,
    workspaces: WorkspacesModule,
};

export const QS_MODULES = {
    sliders: SlidersModule,
    audio: AudioOutputModule,
    toggles: TogglesModule,
    clipboard: ClipboardModule,
    system: SystemModule,
};
