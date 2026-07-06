"use client";

import {
  Bot,
  Check,
  ChevronDown,
  Cloud,
  CloudFog,
  CloudMoon,
  CloudRain,
  Code2,
  Cpu,
  Eye,
  Gamepad2,
  GitBranch,
  Home,
  Languages,
  Mail,
  MapPin,
  MonitorCog,
  Moon,
  Puzzle,
  Radio,
  Send,
  ServerCog,
  Settings2,
  Snowflake,
  Sun,
  Volume2,
  VolumeX,
  Waves,
  Wind,
  Workflow,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { CSSProperties, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  SiCplusplus,
  SiDeno,
  SiDocker,
  SiDotnet,
  SiFramer,
  SiGithub,
  SiJavascript,
  SiLinux,
  SiLua,
  SiMongodb,
  SiMysql,
  SiNextdotjs,
  SiNginx,
  SiNodedotjs,
  SiPterodactyl,
  SiPython,
  SiSqlite,
  SiTailwindcss,
  SiTypescript,
  SiWakatime,
} from "react-icons/si";
import type { IconType } from "react-icons";
import { githubGraph, liveWidgets } from "@/data/live";
import { dictionary, localeLabels, locales } from "@/data/i18n";
import { getLocationByTimeZone, locationPresets } from "@/data/locations";
import { profile } from "@/data/profile";
import { projects } from "@/data/projects";
import { stack } from "@/data/stack";
import type {
  CardIcon,
  GitHubSnapshot,
  Locale,
  Project,
  WeatherCondition,
  WeatherSnapshot,
} from "@/types";

const sceneIds = ["home", "about", "contact", "projects", "stack", "collab"] as const;

const guideAnchors = [
  { selector: "#home .location-trigger", section: "home", placement: "top" },
  { selector: ".weather-trigger", section: "home", placement: "bottom" },
  { selector: ".language-trigger", section: "home", placement: "bottom" },
  { selector: "#about .scene-copy", section: "about", placement: "bottom" },
  { selector: "#projects .github-panel", section: "projects", placement: "bottom" },
  { selector: "#collab .contact-console", section: "collab", placement: "top" },
] as const;

type GuideGeometry = {
  cardTop: number;
  cardLeft: number;
  targetTop: number;
  targetLeft: number;
  targetWidth: number;
  targetHeight: number;
  placement: "top" | "bottom";
};

type SoundscapeKind = "day" | "night" | "wind" | "window-rain" | "storm" | "snow";

type SoundscapeProfile = {
  kind: SoundscapeKind;
  gain: number;
  lowPass: number;
  highPass: number;
};

type AmbientAudio = {
  context: AudioContext;
  source: AudioBufferSourceNode | null;
  gain: GainNode;
  lowPass: BiquadFilterNode;
  highPass: BiquadFilterNode;
  profileKey: string;
};

const projectIcons = {
  desktop: MonitorCog,
  server: ServerCog,
  plugin: Puzzle,
  bot: Bot,
  automation: Workflow,
  utility: Wrench,
};

const stackLogos: Record<string, { Icon: IconType; color: string }> = {
  Python: { Icon: SiPython, color: "#4b8bbe" },
  TypeScript: { Icon: SiTypescript, color: "#3178c6" },
  JavaScript: { Icon: SiJavascript, color: "#f7df1e" },
  "C++": { Icon: SiCplusplus, color: "#659ad2" },
  "C#": { Icon: SiDotnet, color: "#7c55ff" },
  Lua: { Icon: SiLua, color: "#2c2d72" },
  "Node.js": { Icon: SiNodedotjs, color: "#68a063" },
  Deno: { Icon: SiDeno, color: "#f3f4f6" },
  MySQL: { Icon: SiMysql, color: "#4479a1" },
  SQLite: { Icon: SiSqlite, color: "#0f80cc" },
  MongoDB: { Icon: SiMongodb, color: "#47a248" },
  Docker: { Icon: SiDocker, color: "#2496ed" },
  Linux: { Icon: SiLinux, color: "#fcc624" },
  Nginx: { Icon: SiNginx, color: "#009639" },
  GitHub: { Icon: SiGithub, color: "#f0f6fc" },
  Pterodactyl: { Icon: SiPterodactyl, color: "#10539f" },
  "Tailwind CSS": { Icon: SiTailwindcss, color: "#38bdf8" },
  "Next.js": { Icon: SiNextdotjs, color: "#ffffff" },
  "Framer Motion": { Icon: SiFramer, color: "#10a2ff" },
};

const techFallbackIcons = [Code2, Bot, ServerCog, Cpu, GitBranch, Gamepad2];

const socials: Array<[string, string, CardIcon]> = [
  ["GitHub", profile.githubUrl, GitBranch],
  ["Telegram", "#", Send],
  ["Discord", "#", Bot],
  ["Email", "mailto:", Mail],
  ["Automation", "#stack", Workflow],
  ["Server tools", "#projects", ServerCog],
];

const weatherPresets: Array<{ id: WeatherCondition; label: string; icon: CardIcon }> = [
  { id: "clear", label: "Clear", icon: Sun },
  { id: "fair", label: "Fair", icon: Cloud },
  { id: "cloudy", label: "Cloudy", icon: Cloud },
  { id: "overcast", label: "Overcast", icon: CloudMoon },
  { id: "misty", label: "Haze", icon: CloudFog },
  { id: "drizzle", label: "Drizzle", icon: CloudRain },
  { id: "rain", label: "Rain", icon: CloudRain },
  { id: "storm", label: "Storm", icon: Zap },
  { id: "snow", label: "Snow", icon: Snowflake },
  { id: "night", label: "Night", icon: Moon },
];

const fallbackWeather: WeatherSnapshot = {
  ok: false,
  mode: "fallback",
  condition: "overcast",
  label: "Overcast",
  temperature: 14,
  humidity: 56,
  windSpeed: 2,
  windDirection: 225,
  precipitation: 0,
  weatherCode: 3,
  cloudCover: 82,
  isDay: false,
  time: new Date().toISOString(),
  timeZone: "Europe/Moscow",
};

const fallbackGitHub: GitHubSnapshot = {
  ok: false,
  mode: "fallback",
  username: "ShiroKSH",
  commits: 0,
  repositories: 0,
  followers: 0,
  lastPushAt: null,
  lastPushLabel: "offline",
  graph: githubGraph,
};

function sceneLabel(index: number) {
  return `${index + 1}`.padStart(2, "0");
}

function windDirectionLabel(degrees: number) {
  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return directions[Math.round(degrees / 45) % directions.length];
}

function hashText(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours <= 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

function timeZoneParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return {
    key: `${get("year")}-${get("month")}-${get("day")}`,
    minuteOfDay: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

function buildCodingMetrics(date: Date, timeZone: string) {
  const parts = timeZoneParts(date, timeZone);
  const seed = hashText(parts.key);
  const startMinute = 9 * 60 + (seed % 210);
  const dailyTarget = 170 + ((seed >>> 8) % 270);
  const warmup = (seed >>> 16) % 18;
  const todayMinutes = Math.max(0, Math.min(dailyTarget, parts.minuteOfDay - startMinute + warmup));

  return {
    todayLabel: `today: ${formatDuration(todayMinutes)}`,
    targetLabel: formatDuration(dailyTarget),
    totalLabel: "daily rhythm",
  };
}

function WeatherGlyph({ condition }: { condition: WeatherCondition }) {
  const props = { size: 34, "aria-hidden": true } as const;

  switch (condition) {
    case "clear":
      return <Sun {...props} />;
    case "fair":
    case "cloudy":
      return <Cloud {...props} />;
    case "overcast":
      return <CloudMoon {...props} />;
    case "misty":
      return <CloudFog {...props} />;
    case "drizzle":
    case "rain":
      return <CloudRain {...props} />;
    case "storm":
      return <Zap {...props} />;
    case "snow":
      return <Snowflake {...props} />;
    case "night":
      return <Moon {...props} />;
    default:
      return <Cloud {...props} />;
  }
}

function getSoundscapeProfile(condition: WeatherCondition, isNight: boolean): SoundscapeProfile {
  if (condition === "storm") return { kind: "storm", gain: 0.22, lowPass: 1800, highPass: 52 };
  if (condition === "rain") return { kind: "window-rain", gain: 0.19, lowPass: 2300, highPass: 70 };
  if (condition === "drizzle") return { kind: "window-rain", gain: 0.13, lowPass: 2700, highPass: 90 };
  if (condition === "snow") return { kind: "snow", gain: 0.1, lowPass: 920, highPass: 120 };
  if (condition === "cloudy" || condition === "overcast" || condition === "misty") {
    return { kind: "wind", gain: 0.12, lowPass: 1200, highPass: 95 };
  }
  if (condition === "night" || isNight) return { kind: "night", gain: 0.09, lowPass: 3100, highPass: 180 };
  return { kind: "day", gain: 0.075, lowPass: 2400, highPass: 130 };
}

function addDroplet(data: Float32Array, start: number, sampleRate: number, strength: number) {
  const length = Math.floor(sampleRate * (0.025 + Math.random() * 0.07));
  for (let index = 0; index < length && start + index < data.length; index += 1) {
    const decay = 1 - index / length;
    const click = (Math.random() * 2 - 1) * decay * decay * strength;
    data[start + index] += click;
  }
}

function addPulse(data: Float32Array, start: number, sampleRate: number, strength: number) {
  const length = Math.floor(sampleRate * (0.7 + Math.random() * 1.2));
  for (let index = 0; index < length && start + index < data.length; index += 1) {
    const time = index / sampleRate;
    const decay = Math.exp(-time * 2.2);
    data[start + index] += Math.sin(time * 38) * decay * strength;
  }
}

function addNightChirp(data: Float32Array, start: number, sampleRate: number, strength: number) {
  const length = Math.floor(sampleRate * 0.11);
  for (let index = 0; index < length && start + index < data.length; index += 1) {
    const time = index / sampleRate;
    const decay = Math.exp(-time * 26);
    data[start + index] += Math.sin(time * 7200) * decay * strength;
  }
}

function buildSoundscapeBuffer(context: AudioContext, profile: SoundscapeProfile) {
  const duration = 7;
  const buffer = context.createBuffer(1, context.sampleRate * duration, context.sampleRate);
  const data = buffer.getChannelData(0);
  let low = 0;
  let slow = 0;

  for (let index = 0; index < data.length; index += 1) {
    const white = Math.random() * 2 - 1;
    low = (low + 0.028 * white) / 1.028;
    slow = slow * 0.9994 + white * 0.0006;

    if (profile.kind === "window-rain") {
      data[index] = low * 1.8 + white * 0.055;
    } else if (profile.kind === "storm") {
      data[index] = low * 2.4 + slow * 7 + white * 0.08;
    } else if (profile.kind === "snow") {
      data[index] = low * 0.9 + slow * 3.4;
    } else if (profile.kind === "wind") {
      data[index] = low * 1.2 + slow * 5;
    } else if (profile.kind === "night") {
      data[index] = low * 0.42 + white * 0.018;
    } else {
      data[index] = low * 0.34 + white * 0.012;
    }
  }

  if (profile.kind === "window-rain" || profile.kind === "storm") {
    const drops = profile.kind === "storm" ? 110 : 72;
    for (let drop = 0; drop < drops; drop += 1) {
      addDroplet(data, Math.floor(Math.random() * data.length), context.sampleRate, profile.kind === "storm" ? 0.5 : 0.34);
    }
  }

  if (profile.kind === "storm") {
    addPulse(data, Math.floor(context.sampleRate * 1.4), context.sampleRate, 0.42);
    addPulse(data, Math.floor(context.sampleRate * 5.1), context.sampleRate, 0.25);
  }

  if (profile.kind === "night") {
    for (let chirp = 0; chirp < 10; chirp += 1) {
      addNightChirp(data, Math.floor(Math.random() * data.length), context.sampleRate, 0.08);
    }
  }

  return buffer;
}

function ProjectMini({
  project,
  index,
  description,
  links,
}: {
  project: Project;
  index: number;
  description: string;
  links: string[];
}) {
  const Icon = projectIcons[project.visual] ?? Wrench;
  const linkProps = project.isPlaceholder
    ? {}
    : { target: "_blank", rel: "noopener noreferrer" };

  return (
    <article className="project-file">
      <div className="file-icon">
        <Icon size={22} aria-hidden="true" />
        <span>{sceneLabel(index)}</span>
      </div>
      <div>
        <p>{project.status}</p>
        <h3>{project.name}</h3>
        <span>{description}</span>
        <div className="file-tags">
          {project.stack.map((item) => (
            <em key={item}>{item}</em>
          ))}
        </div>
      </div>
      <footer>
        {project.isPlaceholder ? (
          <>
            <span>private</span>
            <span>{project.type}</span>
          </>
        ) : (
          <>
            <a href={project.url} {...linkProps}>
              {links[0]}
            </a>
            <a href={project.detailsUrl} {...linkProps}>
              {links[1]}
            </a>
          </>
        )}
      </footer>
    </article>
  );
}

export function HomeExperience() {
  const guideRef = useRef<HTMLElement | null>(null);
  const ambientAudioRef = useRef<AmbientAudio | null>(null);
  const [locale, setLocale] = useState<Locale>("en");
  const [active, setActive] = useState<(typeof sceneIds)[number]>("home");
  const [guideOpen, setGuideOpen] = useState(true);
  const [guideStep, setGuideStep] = useState(0);
  const [guideGeometry, setGuideGeometry] = useState<GuideGeometry | null>(null);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [ambientOn, setAmbientOn] = useState(true);
  const [soundOn, setSoundOn] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState(() =>
    getLocationByTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone),
  );
  const [weather, setWeather] = useState<WeatherSnapshot>(fallbackWeather);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherOverride, setWeatherOverride] = useState<WeatherCondition | null>(null);
  const [github, setGithub] = useState<GitHubSnapshot>(fallbackGitHub);
  const [time, setTime] = useState({ clock: "--:--", seconds: "--" });
  const [activeTech, setActiveTech] = useState<string | null>(null);
  const [codingMetrics, setCodingMetrics] = useState({
    todayLabel: "today: --",
    targetLabel: "--",
    totalLabel: "daily rhythm",
  });
  const [formState, setFormState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [form, setForm] = useState({ name: "", contact: "", message: "" });
  const copy = dictionary[locale];
  const activeIndex = sceneIds.indexOf(active);
  const visualWeather = weatherOverride ?? weather.condition;
  const currentLocationMinute = timeZoneParts(new Date(), selectedLocation.timeZone).minuteOfDay;
  const clockNight = currentLocationMinute < 7 * 60 || currentLocationMinute >= 20 * 60;
  const nightScene = visualWeather === "night" || (weather.ok ? !weather.isDay : clockNight);
  const soundscapeProfile = getSoundscapeProfile(visualWeather, nightScene);
  const soundscapeKey = `${soundscapeProfile.kind}-${soundscapeProfile.gain}-${soundscapeProfile.lowPass}-${soundscapeProfile.highPass}`;
  const soundscapeLabel = copy.soundscapes[soundscapeProfile.kind];
  const currentGuide = copy.guide.steps[Math.min(guideStep, copy.guide.steps.length - 1)];

  const nav = useMemo(
    () => [
      { id: "home", label: copy.nav.home, icon: Home },
      { id: "about", label: copy.nav.about, icon: Cpu },
      { id: "contact", label: copy.nav.contact, icon: Send },
      { id: "projects", label: copy.nav.projects, icon: GitBranch },
      { id: "stack", label: copy.nav.stack, icon: Waves },
      { id: "collab", label: copy.nav.more, icon: Radio },
    ],
    [copy],
  );

  const liveWidgetRows = useMemo(
    () =>
      liveWidgets.slice(0, 5).map((widget) =>
        widget.label === "Coding time"
          ? { ...widget, value: codingMetrics.todayLabel, detail: `daily target: ${codingMetrics.targetLabel}` }
          : widget,
      ),
    [codingMetrics],
  );

  useEffect(() => {
    const update = () => {
      const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: selectedLocation.timeZone,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).formatToParts(new Date());
      const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "--";
      setTime({ clock: `${get("hour")}:${get("minute")}`, seconds: get("second") });
    };

    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [selectedLocation.timeZone]);

  useEffect(() => {
    const update = () => setCodingMetrics(buildCodingMetrics(new Date(), selectedLocation.timeZone));

    update();
    const timer = window.setInterval(update, 60_000);
    return () => window.clearInterval(timer);
  }, [selectedLocation.timeZone]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({
      lat: String(selectedLocation.latitude),
      lon: String(selectedLocation.longitude),
      tz: selectedLocation.timeZone,
    });

    fetch(`/api/weather?${params.toString()}`)
      .then((response) => response.json())
      .then((snapshot: WeatherSnapshot) => {
        if (!cancelled) setWeather(snapshot);
      })
      .catch(() => {
        if (!cancelled) setWeather(fallbackWeather);
      })
      .finally(() => {
        if (!cancelled) setWeatherLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedLocation]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/github")
      .then((response) => response.json())
      .then((snapshot: GitHubSnapshot) => {
        if (!cancelled) setGithub(snapshot);
      })
      .catch(() => {
        if (!cancelled) setGithub(fallbackGitHub);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const sections = sceneIds
      .map((id) => document.getElementById(id))
      .filter((section): section is HTMLElement => Boolean(section));

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

        if (visible?.target.id && sceneIds.includes(visible.target.id as (typeof sceneIds)[number])) {
          setActive(visible.target.id as (typeof sceneIds)[number]);
        }
      },
      { threshold: [0.42, 0.62, 0.82] },
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>(".reveal-on-scroll"));
    const root = document.documentElement;

    elements.forEach((element, index) => {
      element.style.setProperty("--reveal-delay", `${Math.min(index % 4, 3) * 70}ms`);
      const rect = element.getBoundingClientRect();
      if (rect.top < window.innerHeight * 0.92 && rect.bottom > 0) {
        element.classList.add("is-visible");
      }
    });
    root.classList.add("reveal-ready");

    if (!("IntersectionObserver" in window)) {
      elements.forEach((element) => element.classList.add("is-visible"));
      root.classList.remove("reveal-ready");
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.16, rootMargin: "0px 0px -8% 0px" },
    );

    elements.forEach((element) => observer.observe(element));

    return () => {
      observer.disconnect();
      root.classList.remove("reveal-ready");
    };
  }, []);

  useEffect(() => {
    if (!guideOpen) {
      return;
    }

    let frame = 0;
    const update = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const anchor = guideAnchors[guideStep] ?? guideAnchors[0];
        const target = document.querySelector<HTMLElement>(anchor.selector);

        if (!target) {
          setGuideGeometry(null);
          return;
        }

        const rect = target.getBoundingClientRect();
        const margin = 16;
        const targetVisible =
          rect.bottom > margin &&
          rect.top < window.innerHeight - margin &&
          rect.right > margin &&
          rect.left < window.innerWidth - margin;

        if (!targetVisible) {
          setGuideGeometry(null);
          return;
        }

        const card = guideRef.current;
        const gap = 16;
        const cardWidth = Math.min(card?.offsetWidth ?? 320, window.innerWidth - margin * 2);
        const cardHeight = card?.offsetHeight ?? 180;
        let cardLeft = rect.left + rect.width / 2 - cardWidth / 2;
        let cardTop = rect.bottom + gap;
        let placement: GuideGeometry["placement"] = "bottom";

        if (anchor.placement === "top" && rect.top - cardHeight - gap > margin) {
          cardTop = rect.top - cardHeight - gap;
          placement = "top";
        } else if (cardTop + cardHeight > window.innerHeight - margin && rect.top - cardHeight - gap > margin) {
          cardTop = rect.top - cardHeight - gap;
          placement = "top";
        }

        cardLeft = Math.min(
          Math.max(cardLeft, margin),
          Math.max(margin, window.innerWidth - cardWidth - margin),
        );
        cardTop = Math.min(
          Math.max(cardTop, margin),
          Math.max(margin, window.innerHeight - cardHeight - margin),
        );

        setGuideGeometry({
          cardTop,
          cardLeft,
          targetTop: rect.top,
          targetLeft: rect.left,
          targetWidth: rect.width,
          targetHeight: rect.height,
          placement,
        });
      });
    };

    update();
    const settleTimer = window.setTimeout(update, 350);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("hashchange", update);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settleTimer);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update);
      window.removeEventListener("hashchange", update);
    };
  }, [active, controlsOpen, guideOpen, guideStep, languageOpen, locationOpen]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (form.name.trim().length < 2 || form.contact.trim().length < 3 || form.message.trim().length < 15) {
      setFormState("error");
      return;
    }

    setFormState("loading");
    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, website: "" }),
      });

      if (!response.ok) throw new Error("failed");

      setFormState("success");
      setForm({ name: "", contact: "", message: "" });
    } catch {
      setFormState("error");
    }
  };

  const advanceGuide = () => {
    if (guideStep >= copy.guide.steps.length - 1) {
      setGuideOpen(false);
      return;
    }

    const nextStep = guideStep + 1;
    setGuideStep(nextStep);
    const anchor = guideAnchors[nextStep] ?? guideAnchors[0];
    document.getElementById(anchor.section)?.scrollIntoView({
      behavior: "smooth",
      block: nextStep < 3 ? "nearest" : "center",
    });
  };

  const applySoundscape = (audio: AmbientAudio, profile: SoundscapeProfile, fadeIn = true) => {
    const previousSource = audio.source;
    const source = audio.context.createBufferSource();
    source.buffer = buildSoundscapeBuffer(audio.context, profile);
    source.loop = true;
    source.connect(audio.highPass);
    source.start();

    audio.highPass.frequency.setTargetAtTime(profile.highPass, audio.context.currentTime, 0.18);
    audio.lowPass.frequency.setTargetAtTime(profile.lowPass, audio.context.currentTime, 0.18);
    audio.source = source;
    audio.profileKey = `${profile.kind}-${profile.gain}-${profile.lowPass}-${profile.highPass}`;

    if (fadeIn) {
      audio.gain.gain.setTargetAtTime(profile.gain, audio.context.currentTime, 0.22);
    }

    if (previousSource) {
      window.setTimeout(() => previousSource.stop(), 240);
    }
  };

  const stopAmbientSound = () => {
    const audio = ambientAudioRef.current;
    if (!audio) return;

    audio.gain.gain.setTargetAtTime(0, audio.context.currentTime, 0.08);
    window.setTimeout(() => {
      audio.source?.stop();
      void audio.context.close();
    }, 180);
    ambientAudioRef.current = null;
    setSoundOn(false);
  };

  const startAmbientSound = async () => {
    if (ambientAudioRef.current) {
      const audio = ambientAudioRef.current;
      await audio.context.resume();
      if (audio.profileKey !== soundscapeKey) {
        applySoundscape(audio, soundscapeProfile, false);
      }
      audio.gain.gain.setTargetAtTime(soundscapeProfile.gain, audio.context.currentTime, 0.16);
      setSoundOn(true);
      return;
    }

    const context = new AudioContext();
    const gain = context.createGain();
    const highPass = context.createBiquadFilter();
    const lowPass = context.createBiquadFilter();

    highPass.type = "highpass";
    highPass.frequency.value = soundscapeProfile.highPass;
    lowPass.type = "lowpass";
    lowPass.frequency.value = soundscapeProfile.lowPass;
    lowPass.Q.value = 0.7;
    gain.gain.value = 0;

    highPass.connect(lowPass);
    lowPass.connect(gain);
    gain.connect(context.destination);

    const audio: AmbientAudio = {
      context,
      source: null,
      gain,
      highPass,
      lowPass,
      profileKey: "",
    };

    ambientAudioRef.current = audio;
    applySoundscape(audio, soundscapeProfile);
    setSoundOn(true);
  };

  const toggleAmbientSound = () => {
    if (soundOn) {
      stopAmbientSound();
      return;
    }

    void startAmbientSound();
  };

  useEffect(() => {
    const audio = ambientAudioRef.current;
    if (!audio || !soundOn || audio.profileKey === soundscapeKey) return;

    applySoundscape(audio, soundscapeProfile);
  }, [soundOn, soundscapeKey, soundscapeProfile]);

  useEffect(() => () => stopAmbientSound(), []);

  return (
    <div
      className="ops-shell"
      data-weather={visualWeather}
      data-depth={activeIndex}
      data-night={nightScene ? "on" : "off"}
      data-ambient={ambientOn ? "on" : "off"}
      data-soundscape={soundscapeProfile.kind}
      data-guide={guideOpen && guideGeometry ? "on" : "off"}
      style={{ "--depth-step": activeIndex } as CSSProperties}
    >
      <div className="scene-noise" aria-hidden="true" />
      <div className="weather-stage" aria-hidden="true">
        <div className="sky-layer" />
        <div className="weather-clouds" />
        <div className="ambient-rain" />
        <div className="weather-rain" />
        <div className="desk-lamp-glow" />
        <div className="water-surface" />
        <div className="water-depth" />
        <div className="scene-stars" />
        <div className="scene-bubbles">
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
      </div>

      <aside className="side-rail" aria-label="Scene navigation">
        <a className="mark" href="#home" aria-label="Kushida home">
          K
        </a>
        <nav>
          {nav.map((item) => {
            const Icon = item.icon;
            return (
              <a
                key={item.id}
                href={`#${item.id}`}
                aria-current={active === item.id ? "page" : undefined}
              >
                <Icon size={14} aria-hidden="true" />
                {item.label}
              </a>
            );
          })}
        </nav>
        <div className="guest-card">
          <span />
          <b>KUSHIDA</b>
          <small>guest</small>
        </div>
      </aside>

      <div className="top-hud">
        <div className="signal-chip">
          <Radio size={14} aria-hidden="true" />
          <span>{copy.controls.coding}</span>
          <b>{weatherLoading ? copy.controls.loading : copy.controls.online}</b>
        </div>
      </div>

      <div className="top-actions">
        <button
          type="button"
          className="sound-toggle"
          aria-label={`${soundOn ? copy.controls.soundOff : copy.controls.soundOn}: ${soundscapeLabel}`}
          aria-pressed={soundOn}
          onClick={toggleAmbientSound}
        >
          {soundOn ? <Volume2 size={16} aria-hidden="true" /> : <VolumeX size={16} aria-hidden="true" />}
        </button>
        <button
          type="button"
          className="weather-trigger"
          aria-label={copy.controls.weather}
          aria-expanded={controlsOpen}
          onClick={() => setControlsOpen((value) => !value)}
        >
          <Settings2 size={16} aria-hidden="true" />
        </button>
        <div className="language-menu">
          <button
            type="button"
            className="language-trigger"
            aria-label={copy.controls.language}
            aria-expanded={languageOpen}
            onClick={() => setLanguageOpen((value) => !value)}
          >
            <Languages size={15} aria-hidden="true" />
            {localeLabels[locale]}
          </button>
          {languageOpen ? (
            <div>
              {locales.map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-pressed={locale === item}
                  onClick={() => {
                    setLocale(item);
                    setLanguageOpen(false);
                  }}
                >
                  {localeLabels[item]}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          aria-label={copy.controls.ambient}
          aria-pressed={ambientOn}
          onClick={() => setAmbientOn((value) => !value)}
        >
          <Eye size={16} aria-hidden="true" />
        </button>
      </div>

      {controlsOpen ? (
        <section className="scene-controls" aria-label={copy.controls.scene}>
          <header>
            <p>{copy.controls.scene}</p>
            <button type="button" aria-label={copy.controls.close} onClick={() => setControlsOpen(false)}>
              <X size={14} aria-hidden="true" />
            </button>
          </header>
          <div className="control-tabs">
            <span aria-current="true">
              <CloudRain size={13} aria-hidden="true" />
              {copy.controls.weather}
            </span>
            <span>
              <Waves size={13} aria-hidden="true" />
              {copy.controls.glass}
            </span>
            <span>
              <Eye size={13} aria-hidden="true" />
              {copy.controls.view}
            </span>
          </div>
          <div className="weather-readout">
            <span>{time.clock}</span>
            <b>{weatherOverride ? copy.controls.manual : copy.controls.live}</b>
            <button type="button" onClick={() => setWeatherOverride(null)}>
              {copy.controls.reset}
            </button>
          </div>
          <div className="location-list">
            <p>{copy.controls.location}</p>
            {locationPresets.map((location) => (
              <button
                type="button"
                key={location.id}
                aria-pressed={selectedLocation.id === location.id}
                onClick={() => {
                  setWeatherLoading(true);
                  setSelectedLocation(location);
                  setWeatherOverride(null);
                }}
              >
                <MapPin size={13} aria-hidden="true" />
                {location.label}
                <span>{location.offset}</span>
              </button>
            ))}
          </div>
          <div className="weather-presets">
            <p>{copy.controls.presets}</p>
            {weatherPresets.map((preset) => {
              const Icon = preset.icon;
              return (
                <button
                  type="button"
                  key={preset.id}
                  data-weather-preset={preset.id}
                  aria-pressed={visualWeather === preset.id}
                  onClick={() => setWeatherOverride(preset.id)}
                >
                  <Icon size={18} aria-hidden="true" />
                  {copy.weatherPresets[preset.id]}
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {guideOpen && guideGeometry ? (
        <span
          className="guide-target-ring"
          style={
            {
              top: guideGeometry.targetTop,
              left: guideGeometry.targetLeft,
              width: guideGeometry.targetWidth,
              height: guideGeometry.targetHeight,
            } as CSSProperties
          }
          aria-hidden="true"
        />
      ) : null}

      {guideOpen && guideGeometry ? (
        <aside
          className="tour-card"
          data-placement={guideGeometry.placement}
          ref={guideRef}
          style={
            {
              top: guideGeometry.cardTop,
              left: guideGeometry.cardLeft,
            } as CSSProperties
          }
        >
          <button type="button" aria-label={copy.guide.skip} onClick={() => setGuideOpen(false)}>
            <X size={14} aria-hidden="true" />
          </button>
          <p>
            <span>{copy.guide.label}</span> {guideStep + 1}/6
          </p>
          <h2>{currentGuide[0]}</h2>
          <strong>{currentGuide[1]}</strong>
          <footer>
            <small>{copy.guide.skip}</small>
            <button type="button" onClick={advanceGuide}>
              {currentGuide[2]} <Check size={14} aria-hidden="true" />
            </button>
          </footer>
        </aside>
      ) : null}

      <main className="scene-scroll">
        <section className="scene scene-home" id="home" data-scene>
          <div className="hero-status reveal-on-scroll">
            <span>{time.clock}</span>
            <small>{time.seconds}</small>
            <WeatherGlyph condition={visualWeather} />
            <b>{weather.temperature}°</b>
          </div>

          <div className="weather-meta reveal-on-scroll">
            <span>{selectedLocation.offset}</span>
            <i>
              {weatherOverride
                ? copy.weatherPresets[weatherOverride]
                : weather.label}
            </i>
            <button
              type="button"
              className="location-trigger"
              aria-expanded={locationOpen}
              onClick={() => setLocationOpen((value) => !value)}
            >
              <Home size={15} aria-hidden="true" />
              {selectedLocation.shortLabel}
              <ChevronDown size={14} aria-hidden="true" />
            </button>
            <em>
              <Wind size={15} aria-hidden="true" />
              {weather.windSpeed} km/h {windDirectionLabel(weather.windDirection)}
            </em>
            <em>
              <CloudRain size={15} aria-hidden="true" />
              {weather.humidity}%
            </em>
          </div>

          {locationOpen ? (
            <div className="location-menu">
              <p>{copy.controls.selectLocation}</p>
              {locationPresets.map((location) => (
                <button
                  type="button"
                  key={location.id}
                  onClick={() => {
                    setWeatherLoading(true);
                    setSelectedLocation(location);
                    setWeatherOverride(null);
                    setLocationOpen(false);
                  }}
                >
                  <MapPin size={13} aria-hidden="true" />
                  {location.label}
                  {selectedLocation.id === location.id ? <span>{copy.controls.you}</span> : <small>{location.offset}</small>}
                </button>
              ))}
            </div>
          ) : null}

          <div className={`hero-copy-v3 reveal-on-scroll${guideOpen && guideGeometry ? " guide-offset" : ""}`}>
            <p>{copy.hero.label}</p>
            <h1>{copy.hero.title}</h1>
            <h2>{copy.hero.headline}</h2>
            <span>{copy.hero.description}</span>
            <div>
              <a href="#projects">{copy.hero.buttons[0]}</a>
              <a href="#collab">{copy.hero.buttons[1]}</a>
              <a href={profile.githubUrl} target="_blank" rel="noopener noreferrer">
                {copy.hero.buttons[2]}
              </a>
            </div>
          </div>

          <div className="hero-machine reveal-on-scroll" aria-hidden="true">
            <div className="machine-screen">
              <span>{copy.controls.liveBuild}</span>
              <strong>KSH.OS</strong>
              <i />
              <i />
              <i />
              <code>ui / bots / mysql</code>
            </div>
            <div className="machine-side">
              <span />
              <span />
              <span />
            </div>
            <div className="machine-base" />
            <div className="machine-console">
              <b>01</b>
            </div>
          </div>

          <div className="scroll-cue">
            {copy.controls.scrollCue}
            <ChevronDown size={14} aria-hidden="true" />
          </div>
        </section>

        <section className="scene scene-about" id="about" data-scene>
          <div className="scene-copy reveal-on-scroll">
            <p>{copy.identity.eyebrow}</p>
            <h2>{copy.identity.title}</h2>
            <span>{copy.identity.text}</span>
          </div>
          <div className="ksh-object reveal-on-scroll" aria-label={copy.identity.cardTitle}>
            <div className="ksh-letter">K</div>
            <div className="ksh-slab" />
            <div className="ksh-caption">
              <b>{copy.identity.cardTitle}</b>
              <span>{copy.identity.cardMeta}</span>
            </div>
          </div>
          <div className="skill-cluster reveal-on-scroll">
            {copy.identity.features.map((item, index) => {
              const Icon = techFallbackIcons[index % techFallbackIcons.length];
              return (
                <button type="button" key={item}>
                  <Icon size={20} aria-hidden="true" />
                  {item}
                </button>
              );
            })}
          </div>
        </section>

        <section className="scene scene-contact-grid" id="contact" data-scene>
          <div className="scene-copy reveal-on-scroll">
            <p>{copy.contact.eyebrow}</p>
            <h2>{copy.contact.title}</h2>
            <span>{copy.contact.text}</span>
          </div>
          <div className="social-grid reveal-on-scroll">
            {socials.map(([label, href, Icon]) => (
              <a
                key={label}
                href={href}
                target={href.startsWith("http") ? "_blank" : undefined}
                rel={href.startsWith("http") ? "noopener noreferrer" : undefined}
              >
                <Icon size={26} aria-hidden="true" />
                {label}
              </a>
            ))}
          </div>
          <article className="inline-guide reveal-on-scroll">
            <p>
              <span>ping</span> 03/06
            </p>
            <h2>{profile.githubUrl.replace("https://github.com/", "@")}</h2>
            <strong>{copy.projects.text}</strong>
          </article>
        </section>

        <section className="scene scene-projects" id="projects" data-scene>
          <div className="github-panel reveal-on-scroll">
            <p>github / {github.username}</p>
            <div className="github-stats">
              <b>
                {github.commits}
                <span>{copy.projects.stats[0]}</span>
              </b>
              <b>
                {github.repositories}
                <span>{copy.projects.stats[1]}</span>
              </b>
              <b>
                {github.lastPushLabel}
                <span>{copy.projects.stats[2]}</span>
              </b>
              <b>
                {github.followers}
                <span>{copy.projects.stats[3]}</span>
              </b>
            </div>
            <div className="graph-grid">
              {github.graph.map((level, index) => (
                <i data-level={level} key={`${level}-${index}`} />
              ))}
            </div>
          </div>
          <div className="project-strip reveal-on-scroll">
            <div className="scene-copy compact reveal-on-scroll">
              <p>{copy.projects.eyebrow}</p>
              <h2>{copy.projects.title}</h2>
              <span>{copy.projects.text}</span>
            </div>
            <div className="project-files">
              {projects.map((project, index) => (
                <ProjectMini
                  project={project}
                  index={index}
                  description={copy.projects.descriptions[index]}
                  links={copy.projects.links}
                  key={project.name}
                />
              ))}
            </div>
          </div>
        </section>

        <section className="scene scene-stack" id="stack" data-scene>
          <div className="scene-copy reveal-on-scroll">
            <p>{copy.stack.eyebrow}</p>
            <h2>{copy.stack.title}</h2>
            <span>{copy.stack.text}</span>
            <div className="wakatime-badge">
              <SiWakatime aria-hidden="true" />
              <b>{copy.controls.wakatime}</b>
              <span>{codingMetrics.totalLabel}</span>
            </div>
          </div>
          <div className="tech-dock reveal-on-scroll">
            {stack.map((item) => {
              const logo = stackLogos[item.name];
              const Icon = logo?.Icon;
              return (
                <button
                  type="button"
                  key={item.name}
                  className={activeTech === item.name ? "is-active" : undefined}
                  aria-label={`${item.name}: ${item.hours}`}
                  onMouseEnter={() => setActiveTech(item.name)}
                  onMouseLeave={() => setActiveTech((value) => (value === item.name ? null : value))}
                  onFocus={() => setActiveTech(item.name)}
                  onBlur={() => setActiveTech((value) => (value === item.name ? null : value))}
                  onClick={() => setActiveTech(item.name)}
                >
                  {Icon ? (
                    <Icon aria-hidden="true" className="tech-logo" style={{ color: logo.color }} />
                  ) : (
                    <Code2 className="tech-logo" size={24} aria-hidden="true" />
                  )}
                  <span className="tech-tooltip">
                    <b>{item.name}</b>
                    <small>{item.hours}</small>
                    <em>{item.signal}</em>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="live-ribbon reveal-on-scroll">
            {liveWidgetRows.map((widget) => (
              <article key={widget.label}>
                <span>{widget.label}</span>
                <b>{widget.value}</b>
              </article>
            ))}
          </div>
        </section>

        <section className="scene scene-final" id="collab" data-scene>
          <div className="collab-terminal reveal-on-scroll">
            <p>{copy.collab.kicker}</p>
            <h2>{copy.collab.title}</h2>
            <span>{copy.collab.text}</span>
            <div>
              {copy.terminal.rows.map(([label, value]) => (
                <code key={label}>
                  {label}: <b>{value}</b>
                </code>
              ))}
            </div>
          </div>
          <form className="contact-console reveal-on-scroll" onSubmit={submit}>
            <label htmlFor="name">{copy.contact.fields[0]}</label>
            <input
              id="name"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder={copy.contact.placeholders[0]}
              required
            />
            <label htmlFor="contact-way">{copy.contact.fields[1]}</label>
            <input
              id="contact-way"
              value={form.contact}
              onChange={(event) => setForm({ ...form, contact: event.target.value })}
              placeholder={copy.contact.placeholders[1]}
              required
            />
            <label htmlFor="message">{copy.contact.fields[2]}</label>
            <textarea
              id="message"
              value={form.message}
              onChange={(event) => setForm({ ...form, message: event.target.value })}
              placeholder={copy.contact.placeholders[2]}
              required
            />
            <button type="submit" disabled={formState === "loading"}>
              {copy.contact.button}
              <Send size={14} aria-hidden="true" />
            </button>
            <p aria-live="polite">
              {formState === "success" ? copy.contact.success : null}
              {formState === "error" ? copy.contact.error : null}
            </p>
          </form>
        </section>
      </main>
    </div>
  );
}
