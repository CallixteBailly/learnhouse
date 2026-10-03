export interface LandingBackground {
  type: 'solid' | 'gradient' | 'image';
  color?: string;
  colors?: Array<string>;
  direction?: string;
  image?: string;
}

export interface LandingTestimonialContent {
  text: string;
  author: string;
}

export interface LandingImage {
  url: string;
  alt: string;
  /** Optional fit · cover = photographic crop (default), contain = logo tile on white. */
  fit?: 'cover' | 'contain';
}

export interface LandingHeading {
  text: string;
  color: string;
  size: string;
}

export interface LandingButton {
  text: string;
  link: string;
  color: string;
  background: string;
  /** Optional variant · solid (default) = filled pill, ghost = outlined pill. */
  variant?: 'solid' | 'ghost';
}

export interface LandingLogos {
  type: 'logos';
  title: string;
  /** Optional subtitle under the title. */
  subtitle?: string;
  logos: LandingImage[];
  /** Optional section background (solid/gradient) · absent = transparent. */
  background?: LandingBackground;
}

export interface LandingUsers {
  user_uuid: string;
  name: string;
  description: string;
  image_url: string;
  username?: string;
}

export interface LandingPeople {
  type: 'people';
  title: string;
  people: LandingUsers[];
}

export interface LandingTextAndImageSection {
  type: 'text-and-image';
  title: string;
  text: string;
  flow: 'left' | 'right';
  image?: LandingImage;
  buttons: LandingButton[];
  /** Optional card background (solid/gradient) · absent = open full-width section. */
  background?: LandingBackground;
  /** Optional overrides · absent = default gray-900/gray-600. */
  titleColor?: string;
  textColor?: string;
  /** Optional text alignment · absent = left. */
  align?: 'left' | 'center';
}

export interface LandingStatItem {
  value: string;
  label: string;
  /** Optional accent for the big value · absent = default gold. */
  valueColor?: string;
}

export interface LandingStatsSection {
  type: 'stats';
  title?: string;
  background?: LandingBackground;
  items: LandingStatItem[];
  /** Text color for labels · absent = adapts to dark backgrounds. */
  labelColor?: string;
}

export interface LandingCourse {
  course_uuid: string;
}

export interface LandingFeaturedCourses {
  type: 'featured-courses';
  courses: LandingCourse[];
  title: string;
}

export interface LandingHeroSection {
  type: 'hero';
  title: string;
  background: LandingBackground;
  heading: LandingHeading;
  subheading: LandingHeading;
  buttons: LandingButton[];
  illustration?: {
    image: LandingImage;
    position: 'left' | 'right';
    verticalAlign: 'top' | 'center' | 'bottom';
    size: 'small' | 'medium' | 'large';
  };
  contentAlign?: 'left' | 'center' | 'right';
  /** Optional trust pill rendered above the heading (factual certification claim). */
  badge?: { text: string };
  /** Optional stat band anchored to the hero's bottom edge (hairline-separated). */
  stats?: LandingStatItem[];
  /** Label color for the hero stat band · absent = muted light. */
  statLabelColor?: string;
}

export type LandingSection = LandingTextAndImageSection | LandingHeroSection | LandingLogos | LandingPeople | LandingFeaturedCourses | LandingStatsSection;

export interface LandingObject {
  sections: LandingSection[];
  enabled?: boolean;
} 