<script lang="ts" setup>
import type { EchartsUIType } from '@vben/plugins/echarts';

import { ref, watch } from 'vue';

import { EchartsUI, useEcharts } from '@vben/plugins/echarts';

interface TrendItem {
  date: string;
  pv: number;
  uv: number;
}

const props = defineProps<{
  data?: TrendItem[];
}>();

const chartRef = ref<EchartsUIType>();
const { renderEcharts } = useEcharts(chartRef);

watch(
  () => props.data,
  (items) => {
    const list = Array.isArray(items) ? items : [];
  renderEcharts({
    grid: {
      bottom: 0,
      containLabel: true,
      left: '1%',
      right: '1%',
      top: '2 %',
    },
    series: [
      {
        areaStyle: {},
        data: list.map((item) => item.pv),
        itemStyle: {
          color: '#5ab1ef',
        },
        name: 'PV',
        smooth: true,
        type: 'line',
      },
      {
        areaStyle: {},
        data: list.map((item) => item.uv),
        itemStyle: {
          color: '#019680',
        },
        name: 'UV',
        smooth: true,
        type: 'line',
      },
    ],
    tooltip: {
      axisPointer: {
        lineStyle: {
          color: '#019680',
          width: 1,
        },
      },
      trigger: 'axis',
    },
    // xAxis: {
    //   axisTick: {
    //     show: false,
    //   },
    //   boundaryGap: false,
    //   data: Array.from({ length: 18 }).map((_item, index) => `${index + 6}:00`),
    //   type: 'category',
    // },
    xAxis: {
      axisTick: {
        show: false,
      },
      boundaryGap: false,
      data: list.map((item) => item.date),
      splitLine: {
        lineStyle: {
          type: 'solid',
          width: 1,
        },
        show: true,
      },
      type: 'category',
    },
    yAxis: [
      {
        axisTick: {
          show: false,
        },
        splitArea: {
          show: true,
        },
        splitNumber: 4,
        type: 'value',
      },
    ],
  });
  },
  { immediate: true },
);
</script>

<template>
  <EchartsUI ref="chartRef" />
</template>
