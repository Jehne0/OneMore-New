import { PropsWithChildren, useMemo, useState } from "react";
import { LayoutAnimation, Platform, StyleSheet, TouchableOpacity, UIManager } from "react-native";

import { ThemedText } from "../themed-text";
import { ThemedView } from "../themed-view";
import { IconSymbol } from "./icon-symbol";
import { Colors } from "../../constants/theme";
import { useColorScheme } from "../../hooks/use-color-scheme";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export function Collapsible(
  props: PropsWithChildren & { title: string; initiallyOpen?: boolean }
) {
  const { children, title, initiallyOpen } = props;
  const [isOpen, setIsOpen] = useState(!!initiallyOpen);
  const theme = useColorScheme() ?? "light";

  const tint = useMemo(
    () => (theme === "dark" ? Colors.dark.tint : Colors.light.tint),
    [theme]
  );

  function toggle() {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setIsOpen((v) => !v);
  }

  return (
    <ThemedView style={styles.container}>
      <TouchableOpacity onPress={toggle} style={styles.heading} activeOpacity={0.7}>
        <IconSymbol
          name={isOpen ? "chevron.down" : "chevron.right"}
          size={14}
          color={tint}
        />
        <ThemedText type="defaultSemiBold">{title}</ThemedText>
      </TouchableOpacity>

      {isOpen ? <ThemedView style={styles.content}>{children}</ThemedView> : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 6,
  },
  heading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 6,
  },
  content: {
    marginLeft: 22,
  },
});
