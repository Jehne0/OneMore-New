import { Link } from 'expo-router';
import { StyleSheet } from 'react-native';

import { ThemedText } from '../components/themed-text';
import { ThemedView } from '../components/themed-view';
import { useI18n, type Lang } from '../lib/i18n';

const MODAL_STRINGS: Record<Lang, Record<string, string>> = {
  cs: { title: "Toto je modální okno", home: "Přejít na hlavní obrazovku" },
  en: { title: "This is a modal", home: "Go to the home screen" },
  pl: { title: "To jest okno modalne", home: "Przejdź do ekranu głównego" },
  de: { title: "Dies ist ein Dialog", home: "Zum Startbildschirm" },
};

export default function ModalScreen() {
  const { lang } = useI18n();
  const tx = MODAL_STRINGS[lang];
  return (
    <ThemedView style={styles.container}>
      <ThemedText type="title">{tx.title}</ThemedText>
      <Link href="/" dismissTo style={styles.link}>
        <ThemedText type="link">{tx.home}</ThemedText>
      </Link>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  link: {
    marginTop: 15,
    paddingVertical: 15,
  },
});
