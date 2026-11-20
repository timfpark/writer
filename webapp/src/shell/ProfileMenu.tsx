import {
  Button,
  Header,
  Menu,
  MenuItem,
  MenuSection,
  MenuTrigger,
  Popover,
  Text,
} from "react-aria-components";
import controls from "./controls.module.css";
import styles from "./ProfileMenu.module.css";

// A placeholder for the one local writer; the first release has no sign-in.
export function ProfileMenu() {
  return (
    <MenuTrigger>
      <Button
        className={`${controls.iconButton} ${styles.avatar}`}
        aria-label="Profile"
      >
        <span className={styles.initial} aria-hidden>
          W
        </span>
      </Button>
      <Popover className={styles.popover} placement="bottom end" offset={6}>
        <Menu className={styles.menu} aria-label="Profile">
          <MenuSection>
            <Header className={styles.sectionHeader}>Local writer</Header>
            <MenuItem className={styles.item} textValue="Sign in" isDisabled>
              <Text slot="label" className={styles.label}>
                Sign in
              </Text>
              <Text slot="description" className={styles.description}>
                Not needed on this computer
              </Text>
            </MenuItem>
          </MenuSection>
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}
