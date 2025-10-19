<script setup lang="ts">
defineOptions({
  name: 'NavigationList',
})
interface NavItem {
  id: string
  title: string
  icon?: string
  routeName?: string
  children?: NavItem[]
  disabled?: boolean
}

const props = defineProps<{
  items: NavItem[]
  activeRouteName: string | null
}>()

const emit = defineEmits<{
  (event: 'navigate', routeName: string): void
}>()

function handleNavigate(item: NavItem): void {
  if (!item.routeName || item.disabled) {
    return
  }
  emit('navigate', item.routeName)
}
</script>

<template>
  <v-list density="compact" nav>
    <template v-for="item in props.items" :key="item.id">
      <v-list-group v-if="item.children?.length" :value="item.id">
        <template #activator="{ props: activatorProps }">
          <v-list-item
            v-bind="activatorProps"
            :value="item.id"
            :active="props.activeRouteName === item.routeName"
            :title="item.title"
            :prepend-icon="item.icon"
            :disabled="item.disabled"
            @click.stop="handleNavigate(item)"
          />
        </template>
        <NavigationList
          :items="item.children"
          :active-route-name="props.activeRouteName"
          @navigate="emit('navigate', $event)"
        />
      </v-list-group>
      <v-list-item
        v-else
        :value="item.id"
        :title="item.title"
        :prepend-icon="item.icon"
        :active="props.activeRouteName === item.routeName"
        :disabled="item.disabled"
        @click="handleNavigate(item)"
      />
    </template>
  </v-list>
</template>
