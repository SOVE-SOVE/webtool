import type { Media as MediaConfig } from "@/types";

export function Media({
  media,
  className = "",
  priority = false,
  aspect = "aspect-[4/3]",
}: {
  media: MediaConfig;
  className?: string;
  /** Above-the-fold images (hero) shouldn't lazy-load. */
  priority?: boolean;
  aspect?: string;
}) {
  return (
    <img
      src={media.src}
      alt={media.alt}
      width={media.width}
      height={media.height}
      loading={priority ? "eager" : "lazy"}
      className={`w-full ${aspect} object-cover ${className}`}
    />
  );
}
